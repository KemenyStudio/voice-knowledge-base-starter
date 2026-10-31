// End-to-end test of entity-type memory, audience classification, the entity
// filter and clarifying questions. Uses a temporary member and a temporary
// admin; every change made to the assistant's data is reverted at the end.
//
//   node --env-file=.env scripts/e2e-entity-smoke.mjs <chatbotId> [baseUrl]
import { randomUUID } from "node:crypto"
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

const [chatbotId, base = "http://localhost:3100"] = process.argv.slice(2)
if (!chatbotId) {
  console.error("Usage: e2e-entity-smoke.mjs <chatbotId> [baseUrl]")
  process.exit(1)
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const openai = new OpenAI()
const ref = new URL(url).hostname.split(".")[0]
let passed = 0
let failed = 0
const check = (name, ok, detail = "") => {
  ok ? passed++ : failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`)
}

const { data: chatbot } = await admin.from("chatbots").select("*").eq("id", chatbotId).single()
const options = chatbot.audience_options
const originalFilter = chatbot.audience_filter
const stamp = Date.now()
const users = []

async function makeUser(role) {
  const email = `e2e-${role}-${stamp}@example.com`
  const password = `Pw-${stamp}!`
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  await admin.from("team_members").insert({ team_id: chatbot.team_id, user_id: data.user.id, role })
  users.push(data.user.id)
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: signedIn } = await client.auth.signInWithPassword({ email, password })
  const cookie = `sb-${ref}-auth-token=${encodeURIComponent(JSON.stringify(signedIn.session))}`
  const api = (path, init = {}) =>
    fetch(`${base}${path}`, { redirect: "manual", ...init, headers: { "Content-Type": "application/json", Cookie: cookie, ...init.headers } })
  return { id: data.user.id, api }
}

async function stream(api, body) {
  const res = await api("/api/chat", { method: "POST", body: JSON.stringify({ chatbotId, stream: true, ...body }) })
  const events = []
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const lines = pending.split("\n")
    pending = lines.pop()
    for (const line of lines.filter(Boolean)) events.push(JSON.parse(line))
  }
  return { events, done: events.find((e) => e.type === "done"), deltas: events.filter((e) => e.type === "delta") }
}

const restore = []
try {
  const member = await makeUser("member")
  const boss = await makeUser("admin")

  // --- preferences -------------------------------------------------------
  const prefs0 = await (await member.api(`/api/chatbots/${chatbotId}/preferences`)).json()
  check("preferences start empty with the assistant's options", prefs0.entity_type === null && prefs0.options.length === options.length, JSON.stringify(prefs0))
  const bad = await member.api(`/api/chatbots/${chatbotId}/preferences`, { method: "PUT", body: JSON.stringify({ entity_type: "Panadería" }) })
  check("an unknown entity type is rejected", bad.status === 400, bad.status)
  const saved = await member.api(`/api/chatbots/${chatbotId}/preferences`, { method: "PUT", body: JSON.stringify({ entity_type: "casas de bolsa" }) })
  const savedBody = await saved.json()
  check("entity type is saved with its canonical name", saved.status === 200 && savedBody.entity_type === "Casas de bolsa", JSON.stringify(savedBody))
  const { data: otherPrefs } = await admin.from("assistant_user_prefs").select("*").eq("chatbot_id", chatbotId)
  check("preferences are per user", otherPrefs.filter((p) => p.user_id === member.id).length === 1 && !otherPrefs.some((p) => p.user_id === boss.id))

  // --- permissions ---------------------------------------------------------
  const memberAudience = await member.api("/api/files/audience", { method: "POST", body: JSON.stringify({ action: "from_tags", chatbotId }) })
  check("member cannot run audience actions", memberAudience.status === 403, memberAudience.status)
  const memberPatch = await member.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ audience_filter: true }) })
  check("member cannot turn the filter on", memberPatch.status === 403, memberPatch.status)
  const tooMany = await boss.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ audience_options: Array.from({ length: 15 }, (_, i) => `Tipo ${i}`) }) })
  const tooManyBody = await tooMany.json().catch(() => ({}))
  check("audience options are capped at 8", tooMany.status === 200 && tooManyBody.audience_options.length === 8, JSON.stringify(tooManyBody).slice(0, 150))
  await admin.from("chatbots").update({ audience_options: options }).eq("id", chatbotId)

  // --- classification: suggest, accept, set ---------------------------------
  const { data: unclassified } = await admin
    .from("files").select("*").eq("chatbot_id", chatbotId).eq("audience_status", "unclassified").eq("sync_status", "ready").limit(1)
  const target = unclassified?.[0]
  if (target) {
    restore.push(async () => {
      await admin.from("files").update({
        audience: target.audience ?? [],
        audience_suggested: target.audience_suggested ?? [],
        audience_status: target.audience_status ?? "unclassified",
        metadata: target.metadata,
      }).eq("id", target.id)
      const meta = target.metadata ?? {}
      await openai.vectorStores.files.update(target.openai_file_id, {
        vector_store_id: target.vector_store_id,
        attributes: {
          file_row_id: target.id, chatbot_id: target.chatbot_id, file_name: target.file_name,
          ...(meta.type_tag ? { type_tag: meta.type_tag } : {}),
          ...(meta.target_tag?.length ? { target_tag: meta.target_tag.join(", ") } : {}),
          ...(meta.entity_tag?.length ? { entity_tag: meta.entity_tag.join(", ") } : {}),
        },
      })
    })
    const sug = await boss.api("/api/files/audience", { method: "POST", body: JSON.stringify({ action: "suggest", chatbotId, fileIds: [target.id] }) })
    const sugBody = await sug.json().catch(() => ({}))
    const { data: after } = await admin.from("files").select("audience, audience_suggested, audience_status, metadata").eq("id", target.id).single()
    const wroteLabel = (after.metadata?.target_tag ?? []).length > 0
    check("AI writes who the document is for", sug.status === 200 && sugBody.labeled === 1 && after.audience_status === "confirmed" && wroteLabel && (sugBody.index?.failed ?? []).length === 0, `${sug.status} ${JSON.stringify(sugBody)} ${JSON.stringify(after)}`)
    console.log(`      "${target.file_name.slice(0, 70)}" ->`, after.metadata?.target_tag ?? [], after.audience)
    const vs = await openai.vectorStores.files.retrieve(target.openai_file_id, { vector_store_id: target.vector_store_id })
    const expected = options.filter((o) => after.audience.length && !after.audience.includes(o)).length
    const exclKeys = Object.keys(vs.attributes ?? {}).filter((k) => k.startsWith("excl_"))
    check("index attributes mirror the audience", exclKeys.length === expected && Object.keys(vs.attributes).length <= 16, JSON.stringify(vs.attributes))
  } else {
    console.log("      (no unclassified document to test suggestions on, skipped)")
  }

  // --- entity filter ----------------------------------------------------------
  const filterOn = await boss.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ audience_filter: true }) })
  check("admin can turn the filter on", filterOn.status === 200)
  restore.push(() => admin.from("chatbots").update({ audience_filter: originalFilter }).eq("id", chatbotId))

  const question = "¿Qué es el Costo Anual Total (CAT) y quién lo regula?"
  const filtered = await stream(member.api, { query: [{ content: question }], sessionId: randomUUID() })
  check("filtered answer reports the filter", filtered.done?.entity_filter?.applied === true && filtered.done.entity_filter.entity === "Casas de bolsa", JSON.stringify(filtered.done?.entity_filter))
  console.log("      filtered citations:", (filtered.done?.citations ?? []).map((c) => `${c.title} (${c.file_url})`).slice(0, 5))
  const citedIds = (filtered.done?.citations ?? []).map((c) => c.file_url?.split("/")[3]).filter(Boolean)
  const { data: citedRows } = await admin.from("files").select("file_name, audience, audience_status").in("id", citedIds)
  const wrong = (citedRows ?? []).filter((r) => r.audience_status === "confirmed" && r.audience.length > 0 && !r.audience.includes("Casas de bolsa"))
  check("no cited document is marked for other entity types", wrong.length === 0, JSON.stringify(wrong))
  const { data: stored } = await admin.from("chat_messages").select("meta").eq("id", filtered.done.id).single()
  check("filter info is stored with the message", stored?.meta?.entity_filter?.applied === true, JSON.stringify(stored))

  const unfiltered = await stream(member.api, { query: [{ content: question }], sessionId: randomUUID(), useEntityFilter: false })
  check("'search all documents' disables the filter", unfiltered.done?.entity_filter?.applied === false && unfiltered.done.citations.length > 0, JSON.stringify(unfiltered.done?.entity_filter))

  // --- clarifying questions ----------------------------------------------------
  await member.api(`/api/chatbots/${chatbotId}/preferences`, { method: "PUT", body: JSON.stringify({ entity_type: null }) })
  let clarifySession = randomUUID()
  let first = null
  for (const prompt of [
    "¿Cuál es el capital mínimo que necesito y qué reglas me aplican?",
    "¿Qué requisitos debo cumplir para operar?",
    "Necesito saber el límite, ¿cuál es?",
  ]) {
    clarifySession = randomUUID()
    first = await stream(member.api, { query: [{ content: prompt }], sessionId: clarifySession })
    if (first.done?.clarify) break
  }
  if (first.done?.clarify) {
    const c = first.done.clarify
    check("clarifying question has option buttons", c.options.length >= 2 && !!c.question, JSON.stringify(c))
    check("clarifying question streams no raw tag", !first.deltas.some((d) => /<clarify/i.test(d.text)) && !/<clarify/i.test(first.done.output_text), first.done.output_text)
    check("clarifying question has no sources", first.done.citations.length === 0)
    console.log("      asked:", c.question, "->", c.options, c.kind ?? "")
    const { data: msg } = await admin.from("chat_messages").select("meta, content").eq("id", first.done.id).single()
    check("clarify is stored with the message", msg?.meta?.clarify?.options?.length >= 2, JSON.stringify(msg))
    const answer = await stream(member.api, { query: [{ content: c.options[0] }], sessionId: clarifySession })
    check("the answer after a clarification is not another question", !answer.done?.clarify && answer.done?.output_text.length > 100, JSON.stringify(answer.done?.clarify))
  } else {
    console.log("      (model answered directly instead of asking; clarify plumbing covered by unit tests)")
  }
} catch (error) {
  failed++
  console.error("FAIL  unexpected error:", error)
} finally {
  for (const undo of restore.reverse()) await Promise.resolve(undo()).catch((e) => console.error("restore failed", e))
  for (const id of users) {
    await admin.from("answer_ratings").delete().eq("user_id", id)
    await admin.from("chat_messages").delete().eq("user_id", id)
    await admin.from("assistant_user_prefs").delete().eq("user_id", id)
    await admin.from("team_members").delete().eq("user_id", id)
    await admin.auth.admin.deleteUser(id)
  }
  await admin.from("chatbots").update({ audience_options: options }).eq("id", chatbotId)
  console.log("cleanup done")
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

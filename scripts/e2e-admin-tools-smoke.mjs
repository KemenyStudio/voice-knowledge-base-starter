// End-to-end test of document actions, library health, outdated flags, prompt
// notes, feedback triage, onboarding progress and the knowledge overview.
// Uses a temporary member and a temporary admin; everything the test changes
// on the assistant is reverted at the end and nothing in the index is deleted.
//
//   node --env-file=.env scripts/e2e-admin-tools-smoke.mjs <chatbotId> [baseUrl]
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

const [chatbotId, base = "http://localhost:3100"] = process.argv.slice(2)
if (!chatbotId) {
  console.error("Usage: e2e-admin-tools-smoke.mjs <chatbotId> [baseUrl]")
  process.exit(1)
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const ref = new URL(url).hostname.split(".")[0]
let passed = 0
let failed = 0
const check = (name, ok, detail = "") => {
  ok ? passed++ : failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`)
}

const { data: chatbot } = await admin.from("chatbots").select("*").eq("id", chatbotId).single()
const originalNotes = chatbot.prompt_notes
const stamp = Date.now()
const users = []
const restore = []

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
  const res = await api("/api/chat", { method: "POST", body: JSON.stringify({ chatbotId, stream: true, sessionId: randomUUID(), ...body }) })
  if (res.headers.get("content-type")?.includes("json") && !res.headers.get("content-type").includes("ndjson")) {
    return { status: res.status, error: await res.json().catch(() => ({})) }
  }
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
  return { status: res.status, events, done: events.find((e) => e.type === "done") }
}

const idOf = (c) => c.file_url?.split("/")[3]
const CAT = "eddc9b31-5465-481f-b5db-c13024f4fd6a"
const CARDS = "8e91c94a-5a7d-4142-8d33-e0dbc8f208ff"

try {
  const member = await makeUser("member")
  const boss = await makeUser("admin")

  // --- knowledge overview and onboarding ---------------------------------
  const settings = await (await member.api(`/api/chatbots/${chatbotId}`)).json()
  check("assistant overview reports documents, last update and main types", settings.knowledge?.documents > 100 && !!settings.knowledge.lastUpdated && settings.knowledge.types.length > 0, JSON.stringify(settings.knowledge))
  const onboarding = await (await boss.api(`/api/teams/${chatbot.team_id}/onboarding`)).json()
  check("onboarding reports the four steps", onboarding.steps?.length === 4 && onboarding.steps.find((s) => s.id === "documents")?.done === true, JSON.stringify(onboarding))
  const outsiderTeam = await member.api(`/api/teams/${randomUUID()}/onboarding`)
  check("onboarding of another team is not readable", outsiderTeam.status === 403, outsiderTeam.status)

  // --- document actions ---------------------------------------------------
  const summary = await stream(member.api, { query: [{ content: "Resume el documento «Circular 21/2009»" }], focus: { action: "summarize", fileIds: [CAT] } })
  const sumIds = new Set((summary.done?.citations ?? []).map(idOf))
  check("summary only cites the chosen document", !!summary.done && sumIds.size === 1 && sumIds.has(CAT), JSON.stringify([...sumIds]))
  check("summary is a structured answer without a clarifying question", summary.done?.output_text.length > 500 && !summary.done.clarify, String(summary.done?.output_text).slice(0, 200))
  console.log("      summary:", String(summary.done?.output_text).replace(/\s+/g, " ").slice(0, 260))

  const compare = await stream(member.api, { query: [{ content: "Compara «Circular 21/2009» con «Circular 34/2010»" }], focus: { action: "compare", fileIds: [CAT, CARDS] } })
  const cmpIds = new Set((compare.done?.citations ?? []).map(idOf))
  check("comparison only cites the two chosen documents", !!compare.done && [...cmpIds].every((id) => id === CAT || id === CARDS) && cmpIds.size >= 1, JSON.stringify([...cmpIds]))
  check("comparison uses both documents", cmpIds.has(CAT) && cmpIds.has(CARDS), JSON.stringify([...cmpIds]))
  check("comparison is presented as a table", /\|.*\|/.test(compare.done?.output_text ?? ""), String(compare.done?.output_text).slice(0, 200))
  console.log("      comparison:", String(compare.done?.output_text).replace(/\s+/g, " ").slice(0, 260))

  const changes = await stream(member.api, { query: [{ content: "¿Qué cambió en «Circular 34/2010» respecto a «Circular 21/2009»?" }], focus: { action: "changes", fileIds: [CARDS, CAT] } })
  check("what-changed answers from the two documents only", !!changes.done && (changes.done.citations ?? []).every((c) => [CAT, CARDS].includes(idOf(c))), JSON.stringify((changes.done?.citations ?? []).map(idOf)))

  const wrongCount = await stream(member.api, { query: [{ content: "x" }], focus: { action: "summarize", fileIds: [CAT, CARDS] } })
  check("a summary of two documents is rejected", wrongCount.status === 400, wrongCount.status)
  const foreign = await stream(member.api, { query: [{ content: "x" }], focus: { action: "summarize", fileIds: [randomUUID()] } })
  check("a document of another assistant is rejected", foreign.status === 404, foreign.status)

  // --- outdated flag --------------------------------------------------------
  const memberFlag = await member.api(`/api/files/${CAT}`, { method: "PATCH", body: JSON.stringify({ outdated: true }) })
  check("member cannot flag a document", memberFlag.status === 403, memberFlag.status)
  restore.push(() => admin.from("files").update({ outdated: false, outdated_note: null }).eq("id", CAT))
  const flag = await boss.api(`/api/files/${CAT}`, { method: "PATCH", body: JSON.stringify({ outdated: true, note: "e2e" }) })
  check("admin can flag a document as outdated", flag.status === 200)
  const flagged = await stream(member.api, { query: [{ content: "Resume el documento" }], focus: { action: "summarize", fileIds: [CAT] } })
  check("answers that cite a flagged document say so", (flagged.done?.citations ?? []).some((c) => c.outdated === true), JSON.stringify((flagged.done?.citations ?? []).map((c) => c.outdated)))
  const { data: flaggedMsg } = await admin.from("chat_messages").select("citations").eq("id", flagged.done.id).single()
  check("the warning is kept with the stored message", flaggedMsg.citations.some((c) => c.outdated === true))
  await boss.api(`/api/files/${CAT}`, { method: "PATCH", body: JSON.stringify({ outdated: false }) })

  // --- prompt notes --------------------------------------------------------------
  restore.push(() => admin.from("chatbots").update({ prompt_notes: originalNotes }).eq("id", chatbotId))
  const memberNotes = await member.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ prompt_notes: ["x"] }) })
  check("member cannot edit prompt notes", memberNotes.status === 403, memberNotes.status)
  const tooMany = await boss.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ prompt_notes: Array.from({ length: 11 }, (_, i) => `nota ${i}`) }) })
  check("more than 10 notes are rejected", tooMany.status === 400, tooMany.status)
  const noted = await boss.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ prompt_notes: ["Termina siempre la respuesta con la frase exacta: FIN-E2E-NOTA."] }) })
  check("admin can save a prompt note", noted.status === 200)
  const withNote = await stream(member.api, { query: [{ content: "¿Qué es el CAT?" }] })
  check("the assistant follows the team's note", /FIN-E2E-NOTA/.test(withNote.done?.output_text ?? ""), String(withNote.done?.output_text).slice(-160))
  await admin.from("chatbots").update({ prompt_notes: originalNotes }).eq("id", chatbotId)

  // --- feedback triage ------------------------------------------------------------
  const rated = await stream(member.api, { query: [{ content: "¿Qué es el Costo Anual Total?" }] })
  await member.api("/api/user_interaction", { method: "POST", body: JSON.stringify({ responseId: rated.done.id, rating: -1, comment: "e2e: respuesta incompleta" }) })
  const feed = await (await boss.api("/api/response_feedback")).json()
  const item = (feed.items ?? []).find((i) => i.id === rated.done.id)
  check("feedback lists the sources of the rated answer", !!item && item.sources.length > 0 && item.triage.status === "open" && item.chatbotName === chatbot.name, JSON.stringify(item)?.slice(0, 250))
  const memberFeed = await member.api("/api/response_feedback")
  check("members cannot read feedback", memberFeed.status === 403, memberFeed.status)
  const memberTriage = await member.api("/api/response_feedback", { method: "POST", body: JSON.stringify({ messageId: rated.done.id, userId: member.id, action: "dismiss" }) })
  check("members cannot triage feedback", memberTriage.status === 403, memberTriage.status)

  const triage = (action, extra = {}) =>
    boss.api("/api/response_feedback", { method: "POST", body: JSON.stringify({ messageId: rated.done.id, userId: member.id, action, ...extra }) })
  const status = async () =>
    (await admin.from("answer_ratings").select("triage_status, triage_action, triage_note, triage_file_id").eq("message_id", rated.done.id).eq("user_id", member.id).single()).data

  const noNote = await triage("prompt_note")
  check("a prompt note needs text", noNote.status === 400, noNote.status)
  const addNote = await triage("prompt_note", { note: "e2e: aclara siempre la fecha de vigencia" })
  const { data: afterNote } = await admin.from("chatbots").select("prompt_notes").eq("id", chatbotId).single()
  check("feedback can add a note to the assistant", addNote.status === 200 && afterNote.prompt_notes.includes("e2e: aclara siempre la fecha de vigencia") && (await status()).triage_status === "resolved")
  await admin.from("chatbots").update({ prompt_notes: originalNotes }).eq("id", chatbotId)

  await triage("reopen")
  const sourceId = item.sources.find((s) => s.fileId)?.fileId
  const outdated = await triage("outdated_document", { fileId: sourceId, note: "e2e" })
  const { data: flagRow } = await admin.from("files").select("outdated").eq("id", sourceId).single()
  check("feedback can flag a cited document as outdated", outdated.status === 200 && flagRow.outdated === true && (await status()).triage_file_id === sourceId, outdated.status)
  restore.push(() => admin.from("files").update({ outdated: false, outdated_note: null }).eq("id", sourceId))
  const foreignFile = await triage("outdated_document", { fileId: randomUUID() })
  check("only documents of the assistant can be flagged", foreignFile.status === 404, foreignFile.status)

  await triage("reopen")
  await triage("request_document", { note: "e2e: falta la versión 2025" })
  const requested = await status()
  check("a document request stays open until resolved", requested.triage_status === "open" && requested.triage_action === "request_document")
  await triage("resolve")
  check("a request can be marked resolved", (await status()).triage_status === "resolved")
  await triage("reopen")
  check("a resolved item can be reopened", (await status()).triage_status === "open" && (await status()).triage_action === null)

  // --- library health --------------------------------------------------------------
  const memberHealth = await member.api(`/api/files/health?chatbotId=${chatbotId}`)
  check("members cannot read library health", memberHealth.status === 403, memberHealth.status)
  const health = await (await boss.api(`/api/files/health?chatbotId=${chatbotId}`)).json()
  check("health counts the documents", health.totals?.documents > 100 && health.totals.ready > 100, JSON.stringify(health.totals))
  const dcg = health.issues?.find((i) => i.kind === "no_file")
  check("a row without any file is reported with a clear action", !!dcg && /DCG/.test(dcg.fileName) && dcg.actions.join() === "delete", JSON.stringify(dcg))
  check("a failed indexing is explained in plain language", health.issues?.some((i) => i.kind === "failed" && /vacío/.test(i.detail)), JSON.stringify(health.issues?.filter((i) => i.kind === "failed")))
  console.log(`      index files without a Library entry: ${health.orphans?.total}`, (health.orphans?.items ?? []).map((o) => o.filename).slice(0, 4))
  check("health lists files that are only in the index", typeof health.orphans?.total === "number")
  const fake = await boss.api("/api/files/health", { method: "POST", body: JSON.stringify({ action: "remove_orphans", chatbotId, fileIds: ["file-doesnotexist"] }) })
  const fakeBody = await fake.json().catch(() => ({}))
  check("only real index-only files can be removed", fake.status === 200 && fakeBody.removed === 0 && fakeBody.skipped === 1, JSON.stringify(fakeBody))
  const memberRemove = await member.api("/api/files/health", { method: "POST", body: JSON.stringify({ action: "remove_orphans", chatbotId, fileIds: ["file-x"] }) })
  check("members cannot remove index files", memberRemove.status === 403, memberRemove.status)
} catch (error) {
  failed++
  console.error("FAIL  unexpected error:", error)
} finally {
  for (const undo of restore.reverse()) await Promise.resolve(undo()).catch((e) => console.error("restore failed", e))
  await admin.from("chatbots").update({ prompt_notes: originalNotes }).eq("id", chatbotId)
  for (const id of users) {
    await admin.from("answer_ratings").delete().eq("user_id", id)
    await admin.from("chat_messages").delete().eq("user_id", id)
    await admin.from("assistant_user_prefs").delete().eq("user_id", id)
    await admin.from("team_members").delete().eq("user_id", id)
    await admin.auth.admin.deleteUser(id)
  }
  console.log("cleanup done")
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

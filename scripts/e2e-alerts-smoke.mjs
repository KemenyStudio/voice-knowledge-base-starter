// End-to-end test of regulatory change alerts in an isolated team: real
// uploads (so the detection hook runs), a reader whose real answer cites the
// old document, publishing, in-app notices and the e-mail opt-in rules.
// No e-mail is sent: nobody is both opted in and targeted by a publish that
// asks for e-mails. Everything created is deleted at the end.
//
//   node --env-file=.env scripts/e2e-alerts-smoke.mjs [baseUrl]
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import OpenAI from "openai"

const base = process.argv[2] || "http://localhost:3100"
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const bucket = process.env.SUPABASE_STORAGE_BUCKET || "knowledge"
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const openai = new OpenAI()
const ref = new URL(url).hostname.split(".")[0]
const run = Date.now()
const code = `ZAFIRO-${run}`
let passed = 0
let failed = 0
const check = (name, ok, detail = "") => {
  ok ? passed++ : failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`)
}

const created = { users: [], teamId: null, chatbotId: null }
let vectorStoreId = null

async function makeUser(label) {
  const email = `e2e-${label}-${run}@example.com`
  const password = `Pw-${run}-${label}!`
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  created.users.push(data.user.id)
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: signedIn } = await client.auth.signInWithPassword({ email, password })
  const cookie = `sb-${ref}-auth-token=${encodeURIComponent(JSON.stringify(signedIn.session))}`
  const api = (path, init = {}) =>
    fetch(`${base}${path}`, { redirect: "manual", ...init, headers: { "Content-Type": "application/json", Cookie: cookie, ...init.headers } })
  return { id: data.user.id, email, client, api }
}

async function chat(user, chatbotId, question) {
  const res = await user.api("/api/chat", { method: "POST", body: JSON.stringify({ chatbotId, sessionId: randomUUID(), query: [{ content: question }] }) })
  return { status: res.status, body: await res.json() }
}

try {
  const owner = await makeUser("owner")
  const reader = await makeUser("reader")
  const bystander = await makeUser("bystander")

  const { data: team } = await admin.from("teams").insert({ name: `E2E alerts ${run}`, created_by: owner.id }).select().single()
  created.teamId = team.id
  for (const [user, role] of [[reader, "member"], [bystander, "member"]]) {
    const { error } = await admin.from("team_members").insert({ team_id: team.id, user_id: user.id, role })
    if (error) throw error
  }
  await admin.from("team_members").upsert({ team_id: team.id, user_id: owner.id, role: "admin" }, { onConflict: "team_id,user_id" })
  const { data: chatbot } = await admin.from("chatbots").insert({ team_id: team.id, name: "E2E alerts" }).select().single()
  created.chatbotId = chatbot.id

  const upload = async (name, text) => {
    const signed = await (await owner.api("/api/upload/sign", { method: "POST", body: JSON.stringify({ fileName: name, size: Buffer.byteLength(text), chatbotId: chatbot.id }) })).json()
    const { error } = await owner.client.storage.from(signed.bucket).uploadToSignedUrl(signed.path, signed.token, Buffer.from(text), { contentType: "text/plain" })
    if (error) throw error
    const res = await owner.api("/api/upload", {
      method: "POST",
      body: JSON.stringify({ fileName: name, storagePath: signed.path, chatbotId: chatbot.id, metadata: { type_tag: "Prueba", target_tag: [], entity_tag: [] } }),
    })
    return { status: res.status, ...(await res.json()) }
  }
  const waitReady = async (fileId) => {
    for (let i = 0; i < 40; i++) {
      const res = await owner.api(`/api/files?chatbotId=${chatbot.id}`)
      const row = (await res.json()).find((f) => f.id === fileId)
      if (row?.sync_status === "ready") return true
      await new Promise((r) => setTimeout(r, 3000))
    }
    return false
  }

  // --- detection on upload ---------------------------------------------------------
  const oldDoc = await upload("Circular 99/2030 Reglas de reporte prudencial.txt", `Circular 99/2030. Las entidades deben reportar sus cifras al regulador en 10 días hábiles. Clave de la norma: ${code}.\n`)
  check("the first edition is uploaded and indexed", oldDoc.status === 200 && oldDoc.file?.id && (await waitReady(oldDoc.file.id)), JSON.stringify(oldDoc).slice(0, 200))
  check("a first document suggests nothing", oldDoc.suggestions === 0, oldDoc.suggestions)

  const reply = await chat(reader, chatbot.id, `¿En cuántos días hábiles deben reportar las entidades según la norma ${code}?`)
  const cited = (reply.body.citations ?? []).some((c) => c.file_url === `/api/files/${oldDoc.file.id}/download`)
  check("the reader's real answer cites the first edition", reply.status === 200 && cited, JSON.stringify(reply.body).slice(0, 300))

  const unrelated = await upload("Manual de cocina mexicana.txt", "Recetas de cocina tradicional.\n")
  check("an unrelated document suggests nothing", unrelated.suggestions === 0, unrelated.suggestions)

  const newDoc = await upload("Circular 99/2030 Reglas de reporte prudencial (versión 2031).txt", `Circular 99/2030, versión 2031. Las entidades deben reportar sus cifras al regulador en 5 días hábiles. Clave de la norma: ${code}.\n`)
  check("a new edition of the same document is detected", newDoc.status === 200 && newDoc.suggestions === 1, JSON.stringify(newDoc).slice(0, 200))
  await waitReady(newDoc.file.id)

  const review = await (await owner.api(`/api/alerts?chatbotId=${chatbot.id}&scope=review`)).json()
  const suggestion = review.pending?.[0]
  check("the suggestion is pending and names both documents", review.pending?.length === 1 && suggestion.newFile.id === newDoc.file.id && suggestion.oldFile.id === oldDoc.file.id && suggestion.score >= 0.6, JSON.stringify(review).slice(0, 300))
  const memberReview = await reader.api(`/api/alerts?chatbotId=${chatbot.id}&scope=review`)
  check("members cannot see the review list", memberReview.status === 403, memberReview.status)
  const beforeFile = (await admin.from("files").select("outdated, superseded_by").eq("id", oldDoc.file.id).single()).data
  check("nothing changes until an admin confirms", beforeFile.outdated === false && beforeFile.superseded_by === null)
  const noticeBefore = await (await reader.api(`/api/alerts?chatbotId=${chatbot.id}`)).json()
  check("readers get no notice for a suggestion", noticeBefore.alerts.length === 0)

  // --- permissions and validation ----------------------------------------------------
  const post = (user, body) => user.api("/api/alerts", { method: "POST", body: JSON.stringify({ chatbotId: chatbot.id, ...body }) })
  check("members cannot publish", (await post(reader, { action: "publish", alertId: suggestion.id })).status === 403)
  check("a document cannot replace itself", (await post(owner, { action: "create", newFileId: newDoc.file.id, oldFileId: newDoc.file.id })).status === 400)
  check("alerts need documents of the assistant", (await post(owner, { action: "create", newFileId: newDoc.file.id, oldFileId: randomUUID() })).status === 404)
  const manual = await (await post(owner, { action: "create", newFileId: unrelated.file.id, oldFileId: oldDoc.file.id })).json()
  check("an admin can declare a replacement by hand", !!manual.id && manual.status === "pending", JSON.stringify(manual))

  // --- audience and e-mail opt-in ------------------------------------------------------
  const preview0 = await (await post(owner, { action: "preview", alertId: suggestion.id })).json()
  check("the audience is the people whose answers cited the old document", preview0.recipients === 1 && preview0.emailOptIn === 0, JSON.stringify(preview0))
  const prefsDefault = await (await reader.api(`/api/chatbots/${chatbot.id}/preferences`)).json()
  check("e-mail notices are off by default", prefsDefault.email_alerts === false)
  await reader.api(`/api/chatbots/${chatbot.id}/preferences`, { method: "PUT", body: JSON.stringify({ email_alerts: true }) })
  const preview1 = await (await post(owner, { action: "preview", alertId: suggestion.id })).json()
  check("opting in is counted in the preview", preview1.emailOptIn === 1, JSON.stringify(preview1))
  await reader.api(`/api/chatbots/${chatbot.id}/preferences`, { method: "PUT", body: JSON.stringify({ email_alerts: false }) })

  // --- publish (reader is opted OUT, so no e-mail even though the admin asks) -----------
  const published = await (await post(owner, { action: "publish", alertId: suggestion.id, sendEmails: true })).json()
  check("publishing tells the reader and e-mails nobody who did not opt in", published.status === "published" && published.recipients === 1 && published.emailed === 0 && published.failed === 0, JSON.stringify(published))
  const afterFile = (await admin.from("files").select("outdated, outdated_note, superseded_by").eq("id", oldDoc.file.id).single()).data
  check("the old document is linked to the new one and flagged outdated", afterFile.superseded_by === newDoc.file.id && afterFile.outdated === true && /Reemplazado/.test(afterFile.outdated_note), JSON.stringify(afterFile))
  check("publishing twice is refused", (await post(owner, { action: "publish", alertId: suggestion.id })).status === 409)

  const notice = await (await reader.api(`/api/alerts?chatbotId=${chatbot.id}`)).json()
  check("the reader sees the change in the app", notice.alerts.length === 1 && notice.alerts[0].newFile.id === newDoc.file.id && notice.alerts[0].oldFile.id === oldDoc.file.id, JSON.stringify(notice))
  const bystanderNotice = await (await bystander.api(`/api/alerts?chatbotId=${chatbot.id}`)).json()
  check("people who never saw the old document are not bothered", bystanderNotice.alerts.length === 0)
  const { data: recipientRow } = await admin.from("change_alert_recipients").select("emailed_at, seen_at").eq("user_id", reader.id).single()
  check("no e-mail is recorded", recipientRow.emailed_at === null)

  const outdatedAnswer = await chat(reader, chatbot.id, `¿En cuántos días hábiles deben reportar las entidades según la norma ${code}?`)
  const flagged = (outdatedAnswer.body.citations ?? []).find((c) => c.file_url === `/api/files/${oldDoc.file.id}/download`)
  check("answers that still cite the old document warn about it", !flagged || flagged.outdated === true, JSON.stringify(outdatedAnswer.body.citations?.map((c) => c.outdated)))

  // a document change action compares the two editions
  const changes = await reader.api("/api/chat", { method: "POST", body: JSON.stringify({ chatbotId: chatbot.id, sessionId: randomUUID(), stream: false, query: [{ content: "¿Qué cambió?" }], focus: { action: "changes", fileIds: [newDoc.file.id, oldDoc.file.id] } }) })
  const changesBody = await changes.json()
  check("'Ver qué cambió' explains the difference between the editions", changes.status === 200 && /5/.test(changesBody.output_text) && /10/.test(changesBody.output_text), String(changesBody.output_text).slice(0, 300))
  console.log("      changes:", String(changesBody.output_text).replace(/\s+/g, " ").slice(0, 260))

  // --- dismissing -------------------------------------------------------------------------
  const seen = await reader.api("/api/alerts/seen", { method: "POST", body: JSON.stringify({ chatbotId: chatbot.id, alertId: notice.alerts[0].id }) })
  const afterSeen = await (await reader.api(`/api/alerts?chatbotId=${chatbot.id}`)).json()
  check("a reader can dismiss the notice", seen.status === 200 && afterSeen.alerts.length === 0)
  const dismissed = await (await post(owner, { action: "dismiss", alertId: manual.id })).json()
  check("an admin can dismiss a suggestion", dismissed.status === "dismissed")
  const finalReview = await (await owner.api(`/api/alerts?chatbotId=${chatbot.id}&scope=review`)).json()
  check("the review list keeps only open suggestions and recent publications", finalReview.pending.length === 0 && finalReview.published.length === 1)

  // --- opt-in e-mail path without sending anything ----------------------------------------------
  await reader.api(`/api/chatbots/${chatbot.id}/preferences`, { method: "PUT", body: JSON.stringify({ email_alerts: true }) })
  const second = await (await post(owner, { action: "create", newFileId: newDoc.file.id, oldFileId: unrelated.file.id })).json()
  const quiet = await (await post(owner, { action: "publish", alertId: second.id, sendEmails: false })).json()
  check("an opted-in reader is not e-mailed unless the admin asks", quiet.status === "published" && quiet.emailed === 0, JSON.stringify(quiet))
} catch (error) {
  failed++
  console.error("FAIL  unexpected error:", error)
} finally {
  try {
    if (created.chatbotId) {
      const { data } = await admin.from("chatbots").select("vector_store_id").eq("id", created.chatbotId).single()
      vectorStoreId = data?.vector_store_id ?? null
      const { data: rows } = await admin.from("files").select("blob_name").eq("chatbot_id", created.chatbotId)
      const paths = (rows ?? []).map((r) => r.blob_name).filter(Boolean)
      if (paths.length) await admin.storage.from(bucket).remove(paths)
      await admin.from("change_alerts").delete().eq("chatbot_id", created.chatbotId)
      await admin.from("chat_messages").delete().eq("chatbot_id", created.chatbotId)
      await admin.from("assistant_user_prefs").delete().eq("chatbot_id", created.chatbotId)
      await admin.from("files").delete().eq("chatbot_id", created.chatbotId)
      await admin.from("chatbots").delete().eq("id", created.chatbotId)
    }
    if (created.teamId) {
      await admin.from("team_members").delete().eq("team_id", created.teamId)
      await admin.from("teams").delete().eq("id", created.teamId)
    }
    for (const id of created.users) await admin.auth.admin.deleteUser(id)
    if (vectorStoreId) {
      const remote = await openai.vectorStores.files.list(vectorStoreId).catch(() => null)
      for (const f of remote?.data ?? []) await openai.files.delete(f.id).catch(() => undefined)
      await openai.vectorStores.delete(vectorStoreId).catch(() => undefined)
    }
    console.log("cleanup done")
  } catch (error) {
    console.error("cleanup problem:", error)
  }
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

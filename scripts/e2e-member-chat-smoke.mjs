// End-to-end test of what a plain team MEMBER can do on an existing assistant:
// chat with citations, rate an answer, see history, and (not) upload.
// The temporary member and everything they create is deleted at the end.
//
//   node --env-file=.env scripts/e2e-member-chat-smoke.mjs <chatbotId> [baseUrl]
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

const [chatbotId, base = "http://localhost:3100"] = process.argv.slice(2)
if (!chatbotId) {
  console.error("Usage: e2e-member-chat-smoke.mjs <chatbotId> [baseUrl]")
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

const { data: chatbot } = await admin.from("chatbots").select("id, team_id").eq("id", chatbotId).single()
const email = `e2e-member-${Date.now()}@example.com`
const password = `Pw-${Date.now()}!`
const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
const userId = created.user.id

try {
  await admin.from("team_members").insert({ team_id: chatbot.team_id, user_id: userId, role: "member" })
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: signedIn } = await client.auth.signInWithPassword({ email, password })
  const cookie = `sb-${ref}-auth-token=${encodeURIComponent(JSON.stringify(signedIn.session))}`
  const api = (path, init = {}) =>
    fetch(`${base}${path}`, { redirect: "manual", ...init, headers: { "Content-Type": "application/json", Cookie: cookie, ...init.headers } })

  const sessionId = randomUUID()
  const ask = async (text) => {
    const res = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ query: [{ content: text }], chatbotId, sessionId }),
    })
    return { res, body: await res.json().catch(() => ({})) }
  }

  // 1) A clear question is answered straight away (no "do you confirm?" turn),
  //    streamed: the first text must arrive well before the answer is complete.
  const started = Date.now()
  const streamRes = await api("/api/chat", {
    method: "POST",
    body: JSON.stringify({
      query: [{ content: "¿Qué es el Costo Anual Total (CAT) y quién lo regula?" }],
      chatbotId,
      sessionId,
      stream: true,
    }),
  })
  check("streaming answers with application/x-ndjson", streamRes.status === 200 && (streamRes.headers.get("content-type") ?? "").includes("ndjson"), `${streamRes.status} ${streamRes.headers.get("content-type")}`)
  const events = []
  let firstDeltaMs = null
  const reader = streamRes.body.getReader()
  const decoder = new TextDecoder()
  let pending = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    pending += decoder.decode(value, { stream: true })
    const lines = pending.split("\n")
    pending = lines.pop()
    for (const line of lines.filter(Boolean)) {
      const event = JSON.parse(line)
      if (event.type === "delta" && firstDeltaMs === null) firstDeltaMs = Date.now() - started
      events.push(event)
    }
  }
  const totalMs = Date.now() - started
  const deltas = events.filter((e) => e.type === "delta")
  const done = events.find((e) => e.type === "done")
  check("many text pieces arrive before the end", deltas.length > 5, `deltas=${deltas.length}`)
  check("first text arrives before the answer is complete", firstDeltaMs !== null && firstDeltaMs < totalMs - 1000, `first=${firstDeltaMs}ms total=${totalMs}ms`)
  console.log(`      first text after ${(firstDeltaMs / 1000).toFixed(1)}s, complete after ${(totalMs / 1000).toFixed(1)}s`)
  check("stream ends with a done event", !!done && String(done.id).startsWith("resp_"), JSON.stringify(events.at(-1)).slice(0, 150))
  check("done carries the final text and citations", !!done?.output_text && done.citations?.length > 0, JSON.stringify(done).slice(0, 150))
  check("answers directly (not a confirmation question)", !!done && done.output_text.length > 600 && !/¿Confirmas|¿Deseas que|¿Quieres que/i.test(done.output_text.slice(0, 200)), String(done?.output_text).slice(0, 200))
  const followups = events.find((e) => e.type === "followups")
  check("2-3 follow-up suggestions arrive after the answer", !!followups && followups.questions.length >= 1 && followups.questions.length <= 3 && events.indexOf(followups) > events.indexOf(done), JSON.stringify(followups))
  console.log("      follow-ups:", followups?.questions)
  console.log("      answer:", String(done?.output_text).replace(/\s+/g, " ").slice(0, 220))
  console.log("      cited:", [...new Set((done?.citations ?? []).map((c) => c.title))].slice(0, 4))

  // 2) A follow-up in the same conversation (state carries over), non-streaming.
  const second = await ask("¿Y cómo se calcula?")
  check("follow-up question works (conversation state)", second.res.status === 200 && !!second.body.output_text, `${second.res.status}`)

  // 3) An unclear message gets ONE short question, not a long answer.
  const vague = await ask("necesito ayuda con algo")
  const vagueText = String(vague.body.output_text ?? "")
  check("unclear message gets one short reply, not a long answer", vague.res.status === 200 && vagueText.length > 0 && vagueText.length < 500 && (vagueText.match(/\?/g) ?? []).length <= 1, vagueText.slice(0, 300))
  console.log("      unclear ->", vagueText.replace(/\s+/g, " ").slice(0, 200))

  const rate = await api("/api/user_interaction", { method: "POST", body: JSON.stringify({ responseId: done.id, rating: 1, comment: "e2e" }) })
  check("member can rate an answer", [200, 201].includes(rate.status), rate.status)

  const sessions = await api("/api/sessions", { method: "POST", body: JSON.stringify({ chatbotId }) })
  const list = await sessions.json().catch(() => [])
  check("session appears in history list", sessions.status === 200 && Array.isArray(list) && list.some((x) => x.session === sessionId), `${sessions.status} ${JSON.stringify(list).slice(0, 150)}`)
  const history = await api("/api/history", { method: "POST", body: JSON.stringify({ chatbotId, sessionId }) })
  const msgs = await history.json().catch(() => [])
  check("transcript has 6 messages, each stored once", history.status === 200 && Array.isArray(msgs) && msgs.length === 6, `${history.status} count=${msgs.length}`)
  const firstAnswer = msgs.find((m) => m.role === "assistant")
  check("transcript keeps ids, sources and follow-ups", firstAnswer?.id === done.id && firstAnswer.citations?.length > 0 && !!firstAnswer.citations[0].text && firstAnswer.meta?.follow_ups?.length >= 1, JSON.stringify(firstAnswer)?.slice(0, 200))

  // Assistant texts: members read, only admins edit.
  const settings = await api(`/api/chatbots/${chatbotId}`)
  const settingsBody = await settings.json().catch(() => ({}))
  check("member can read assistant settings", settings.status === 200 && Array.isArray(settingsBody.suggested_questions), settings.status)
  const memberPatch = await api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ welcome_message: "hack" }) })
  check("member cannot edit assistant settings", memberPatch.status === 403, memberPatch.status)

  // Sharing: a frozen copy readable by team members only.
  const share = await api("/api/conversations/share", { method: "POST", body: JSON.stringify({ chatbotId, sessionId }) })
  const shareBody = await share.json().catch(() => ({}))
  check("member can share a conversation", share.status === 200 && /^\/shared\//.test(shareBody.path ?? ""), `${share.status} ${JSON.stringify(shareBody)}`)
  const { data: sharedRow } = await client.from("conversation_shares").select("id, messages").eq("id", shareBody.id).maybeSingle()
  check("shared copy has the whole conversation", sharedRow?.messages?.length === 6, JSON.stringify(sharedRow)?.slice(0, 150))
  const outsider = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: outsiderRow } = await outsider.from("conversation_shares").select("id").eq("id", shareBody.id).maybeSingle()
  check("anonymous users cannot read a shared conversation", !outsiderRow)
  const emptyShare = await api("/api/conversations/share", { method: "POST", body: JSON.stringify({ chatbotId, sessionId: randomUUID() }) })
  check("sharing an empty conversation is rejected", emptyShare.status === 404, emptyShare.status)

  const files = await api(`/api/files?chatbotId=${chatbotId}`)
  const fileBody = await files.json().catch(() => ({}))
  const fileList = Array.isArray(fileBody) ? fileBody : fileBody.files ?? []
  check("member can read the library", files.status === 200 && fileList.length > 100, `${files.status} count=${fileList.length}`)

  const sign = await api("/api/upload/sign", { method: "POST", body: JSON.stringify({ fileName: "x.txt", size: 5, chatbotId }) })
  check("member cannot upload", sign.status === 403, sign.status)
  if (fileList[0]) {
    const del = await api(`/api/files/${fileList[0].id}`, { method: "DELETE" })
    check("member cannot delete documents", del.status === 403, del.status)
    const dl = await api(`/api/files/${fileList[0].id}/download`)
    check("member can open a document", dl.status === 302, dl.status)
  }
} catch (error) {
  failed++
  console.error("FAIL  unexpected error:", error)
} finally {
  await admin.from("conversation_shares").delete().eq("user_id", userId)
  await admin.from("answer_ratings").delete().eq("user_id", userId)
  await admin.from("chat_messages").delete().eq("user_id", userId)
  await admin.from("team_members").delete().eq("user_id", userId)
  await admin.auth.admin.deleteUser(userId)
  console.log("cleanup done")
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

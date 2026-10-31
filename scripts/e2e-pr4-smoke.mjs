// End-to-end test of research mode, assistant tools and regulatory change
// alerts. Uses temporary users; every change made to the assistant is
// reverted, no email is sent (nobody in the test opts in to email with a real
// address) and nothing is deleted from the index.
//
//   node --env-file=.env scripts/e2e-pr4-smoke.mjs <chatbotId> [baseUrl]
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

const [chatbotId, base = "http://localhost:3100"] = process.argv.slice(2)
if (!chatbotId) {
  console.error("Usage: e2e-pr4-smoke.mjs <chatbotId> [baseUrl]")
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
const original = { research_enabled: chatbot.research_enabled, enabled_tools: chatbot.enabled_tools }
const stamp = Date.now()
const users = []
const restore = []

let counter = 0
async function makeUser(role) {
  const email = `e2e-${role}-${stamp}-${++counter}@example.com`
  const password = `Pw-${stamp}!`
  const { data } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  await admin.from("team_members").insert({ team_id: chatbot.team_id, user_id: data.user.id, role })
  users.push(data.user.id)
  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
  const { data: signedIn } = await client.auth.signInWithPassword({ email, password })
  const cookie = `sb-${ref}-auth-token=${encodeURIComponent(JSON.stringify(signedIn.session))}`
  const api = (path, init = {}) =>
    fetch(`${base}${path}`, { redirect: "manual", ...init, headers: { "Content-Type": "application/json", Cookie: cookie, ...init.headers } })
  return { id: data.user.id, email, api }
}

async function stream(api, body) {
  const res = await api("/api/chat", { method: "POST", body: JSON.stringify({ chatbotId, stream: true, sessionId: randomUUID(), ...body }) })
  const type = res.headers.get("content-type") ?? ""
  if (!type.includes("ndjson")) return { status: res.status, error: await res.json().catch(() => ({})) }
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

try {
  const member = await makeUser("member")
  const boss = await makeUser("admin")

  // --- research mode ---------------------------------------------------------
  const notStreamed = await member.api("/api/chat", { method: "POST", body: JSON.stringify({ chatbotId, sessionId: randomUUID(), query: [{ content: "x" }], research: true }) })
  check("research without streaming is rejected", notStreamed.status === 400, notStreamed.status)
  const withFocus = await stream(member.api, { query: [{ content: "x" }], research: true, focus: { action: "summarize", fileIds: ["eddc9b31-5465-481f-b5db-c13024f4fd6a"] } })
  check("research cannot be combined with a document action", withFocus.status === 400, withFocus.status)

  const question = "Compara qué obligaciones de transparencia y de cálculo del CAT aplican a los créditos al consumo y a las tarjetas de crédito, y qué excepciones existen"
  const started = Date.now()
  const research = await stream(member.api, { query: [{ content: question }], research: true })
  const seconds = Math.round((Date.now() - started) / 1000)
  const types = (research.events ?? []).map((e) => e.type)
  const plan = research.events?.find((e) => e.type === "plan")
  check("research streams a plan of 2 to 4 searches", !!plan && plan.steps.length >= 2 && plan.steps.length <= 4, JSON.stringify(plan))
  const stepEvents = (research.events ?? []).filter((e) => e.type === "step")
  check("every search reports running and done", plan?.steps.every((s) => stepEvents.some((e) => e.id === s.id && e.status === "searching") && stepEvents.some((e) => e.id === s.id && e.status === "done")), JSON.stringify(stepEvents))
  check("steps arrive before the answer text", types.indexOf("plan") < types.indexOf("delta") && types.lastIndexOf("step") < types.indexOf("delta"), types.join(","))
  check("the research answer completes with follow-ups", !!research.done && types.includes("followups"), types.join(","))
  const cited = new Set([...(research.done?.output_text ?? "").matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1])))
  const numbers = new Set((research.done?.citations ?? []).map((c) => c.number))
  check("research cites several documents that exist in the evidence", cited.size >= 2 && [...cited].every((n) => numbers.has(n)), JSON.stringify([[...cited], [...numbers]]))
  check("the done event carries the searches", research.done?.research?.steps.length === plan?.steps.length, JSON.stringify(research.done?.research))
  check("research answers are not clarifying questions", !research.done?.clarify)
  console.log(`      research took ${seconds}s; steps: ${plan?.steps.map((s) => s.label).join(" | ")}; ${research.done?.citations.length} documents`)
  console.log("      answer:", String(research.done?.output_text).replace(/\s+/g, " ").slice(0, 260))
  const { data: stored } = await admin.from("chat_messages").select("meta, citations").eq("id", research.done.id).single()
  check("the searches are stored with the message", stored.meta.research?.steps?.length === plan?.steps.length)
  const { data: history } = await member.api("/api/history", { method: "POST", body: JSON.stringify({ chatbotId, sessionId: "none" }) }).then((r) => r.json().then((d) => ({ data: d })))
  check("history endpoint still answers", Array.isArray(history))

  // a follow-up question in the same session keeps working after a research turn
  const sessionId = randomUUID()
  const first = await stream(member.api, { sessionId, query: [{ content: "¿Qué es el CAT?" }], research: true })
  const second = await stream(member.api, { sessionId, query: [{ content: "¿Y quién lo calcula?" }] })
  check("a normal question after a research answer works", !!first.done && !!second.done && second.done.output_text.length > 50, JSON.stringify(second.error ?? second.events?.slice(-1)))

  restore.push(() => admin.from("chatbots").update({ research_enabled: original.research_enabled }).eq("id", chatbotId))
  const memberToggle = await member.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ research_enabled: false }) })
  check("members cannot turn research off", memberToggle.status === 403, memberToggle.status)
  await boss.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ research_enabled: false }) })
  const off = await stream(member.api, { query: [{ content: "x" }], research: true })
  check("research is refused when the assistant turns it off", off.status === 403, off.status)
  const settings = await (await member.api(`/api/chatbots/${chatbotId}`)).json()
  check("members can read that research is off", settings.research_enabled === false)
  await boss.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ research_enabled: original.research_enabled }) })

  const heavy = await makeUser("member")
  const rows = Array.from({ length: 15 }, (_, i) => ({
    id: `resp_e2e_${stamp}_${i}`, user_id: heavy.id, chatbot_id: chatbotId, session_id: `limit-${stamp}`, role: "assistant", content: "x", title: "x", citations: [], meta: { research: { steps: [] } },
  }))
  await admin.from("chat_messages").insert(rows)
  const limited = await stream(heavy.api, { query: [{ content: "x" }], research: true })
  check("research is limited to 15 per user per day", limited.status === 429 && /15/.test(limited.error?.error ?? ""), JSON.stringify(limited.error))
  const normal = await stream(heavy.api, { query: [{ content: "¿Qué es el CAT?" }] })
  check("the limit does not block normal questions", !!normal.done)

  // --- tools beyond search ----------------------------------------------------------
  const listed = await (await member.api(`/api/tools?chatbotId=${chatbotId}`)).json()
  check("members see the tools the assistant offers", listed.tools?.map((t) => t.id).sort().join() === "check_validity,draft_email,memo", JSON.stringify(listed))
  const answerId = research.done.id
  const email = await member.api("/api/tools", { method: "POST", body: JSON.stringify({ chatbotId, tool: "draft_email", messageId: answerId, instructions: "Para el director jurídico, tono breve" }) })
  const emailBody = await email.json()
  check("draft_email writes a subject and a body from the answer", email.status === 200 && /^Asunto:/m.test(emailBody.text) && emailBody.text.length > 300, JSON.stringify(emailBody).slice(0, 300))
  console.log("      email:", String(emailBody.text).replace(/\s+/g, " ").slice(0, 200))
  const memo = await member.api("/api/tools", { method: "POST", body: JSON.stringify({ chatbotId, tool: "memo", messageId: answerId }) })
  const memoBody = await memo.json()
  check("memo has the expected sections", memo.status === 200 && /Resumen ejecutivo/i.test(memoBody.text) && /Fuentes/i.test(memoBody.text), String(memoBody.text).slice(0, 300))
  const validity = await member.api("/api/tools", { method: "POST", body: JSON.stringify({ chatbotId, tool: "check_validity", fileId: "eddc9b31-5465-481f-b5db-c13024f4fd6a" }) })
  const validityBody = await validity.json()
  check("check_validity reports what the document says about its dates", validity.status === 200 && /Vigencia: Circular 21\/2009/.test(validityBody.text) && /Lo que dice el documento/.test(validityBody.text), String(validityBody.text).slice(0, 300))
  console.log("      validity:", String(validityBody.text).replace(/\s+/g, " ").slice(0, 260))
  const noMessage = await member.api("/api/tools", { method: "POST", body: JSON.stringify({ chatbotId, tool: "draft_email" }) })
  check("an answer tool needs a message id", noMessage.status === 400, noMessage.status)
  const noFile = await member.api("/api/tools", { method: "POST", body: JSON.stringify({ chatbotId, tool: "check_validity" }) })
  check("check_validity needs a document id", noFile.status === 400, noFile.status)
  const foreignAnswer = await boss.api("/api/tools", { method: "POST", body: JSON.stringify({ chatbotId, tool: "memo", messageId: answerId }) })
  check("a tool cannot use someone else's answer", foreignAnswer.status === 404, foreignAnswer.status)
  const foreignFile = await member.api("/api/tools", { method: "POST", body: JSON.stringify({ chatbotId, tool: "check_validity", fileId: randomUUID() }) })
  check("a tool cannot use a document of another assistant", foreignFile.status === 404, foreignFile.status)

  const { data: logged } = await admin.from("tool_runs").select("tool, status, input, output_chars").eq("user_id", member.id)
  check("every run is in the audit log", logged.length >= 3 && logged.filter((r) => r.status === "ok").length === 3 && logged.every((r) => r.status !== "ok" || r.output_chars > 100), JSON.stringify(logged))
  check("the audit log keeps inputs but not generated text", logged.every((r) => !("text" in r.input)) && logged.some((r) => r.input.instructions === "Para el director jurídico, tono breve"))
  const memberRuns = await member.api(`/api/tools/runs?chatbotId=${chatbotId}`)
  check("members cannot read the audit log", memberRuns.status === 403, memberRuns.status)
  const adminRuns = await (await boss.api(`/api/tools/runs?chatbotId=${chatbotId}`)).json()
  check("admins can read the audit log with the user", adminRuns.runs?.some((r) => r.user_email === member.email && r.tool === "draft_email"), JSON.stringify(adminRuns).slice(0, 200))

  const memberTools = await member.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ enabled_tools: [] }) })
  check("members cannot change the tools", memberTools.status === 403, memberTools.status)
  const badTool = await boss.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ enabled_tools: ["send_email"] }) })
  check("unknown tools are rejected", badTool.status === 400, badTool.status)
  await boss.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ enabled_tools: ["memo"] }) })
  const blocked = await member.api("/api/tools", { method: "POST", body: JSON.stringify({ chatbotId, tool: "draft_email", messageId: answerId }) })
  check("a tool the admin switched off is refused", blocked.status === 403, blocked.status)
  const onlyMemo = await (await member.api(`/api/tools?chatbotId=${chatbotId}`)).json()
  check("and disappears from the list", onlyMemo.tools?.length === 1 && onlyMemo.tools[0].id === "memo")
  await boss.api(`/api/chatbots/${chatbotId}`, { method: "PATCH", body: JSON.stringify({ enabled_tools: original.enabled_tools }) })

  const busy = await makeUser("member")
  await admin.from("tool_runs").insert(Array.from({ length: 30 }, () => ({ chatbot_id: chatbotId, user_id: busy.id, tool: "memo", status: "ok", input: {} })))
  const throttled = await busy.api("/api/tools", { method: "POST", body: JSON.stringify({ chatbotId, tool: "check_validity", fileId: "eddc9b31-5465-481f-b5db-c13024f4fd6a" }) })
  check("tools are limited to 30 runs per hour", throttled.status === 429, throttled.status)
} catch (error) {
  failed++
  console.error("FAIL  unexpected error:", error)
} finally {
  for (const undo of restore.reverse()) await Promise.resolve(undo()).catch((e) => console.error("restore failed", e))
  await admin.from("chatbots").update({ research_enabled: original.research_enabled, enabled_tools: original.enabled_tools }).eq("id", chatbotId)
  const { data: extra } = await admin.auth.admin.listUsers({ perPage: 1000 })
  for (const u of extra.users.filter((u) => u.email?.startsWith(`e2e-`) && u.email.includes(String(stamp)))) if (!users.includes(u.id)) users.push(u.id)
  for (const id of users) {
    await admin.from("tool_runs").delete().eq("user_id", id)
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

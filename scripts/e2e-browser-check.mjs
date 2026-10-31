// Drives the real UI in a headless Chromium as a temporary team admin and
// checks the main chat flows. The temporary user and everything it creates is
// deleted at the end.
//
//   PLAYWRIGHT_MODULE=/path/to/node_modules/playwright/index.mjs \
//   CHROMIUM_PATH=/path/to/chrome-headless-shell \
//   node --env-file=.env scripts/e2e-browser-check.mjs <chatbotId> [baseUrl] [screenshotDir]
//
// Playwright is not a dependency of the app; install it anywhere (for example
// `npm i playwright` in a temp folder) and point PLAYWRIGHT_MODULE at it.
import { mkdirSync } from "node:fs"
import { pathToFileURL } from "node:url"
import { createClient } from "@supabase/supabase-js"

const [chatbotId, base = "http://localhost:3100", shots = "/tmp/document-search-shots"] = process.argv.slice(2)
if (!chatbotId) {
  console.error("Usage: e2e-browser-check.mjs <chatbotId> [baseUrl] [screenshotDir]")
  process.exit(1)
}
mkdirSync(shots, { recursive: true })

const playwrightPath = process.env.PLAYWRIGHT_MODULE
const { chromium } = await import(playwrightPath ? pathToFileURL(playwrightPath).href : "playwright")

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

let passed = 0
let failed = 0
const check = (name, ok, detail = "") => {
  ok ? passed++ : failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${detail}`}`)
}

const { data: chatbot } = await admin
  .from("chatbots")
  .select("id, name, team_id, welcome_message, suggested_questions, audience_options")
  .eq("id", chatbotId)
  .single()
const email = `e2e-browser-${Date.now()}@example.com`
const password = `Pw-${Date.now()}!`
const { data: created } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
const userId = created.user.id
await admin.from("team_members").insert({ team_id: chatbot.team_id, user_id: userId, role: "admin" })

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {})
const context = await browser.newContext({
  viewport: { width: 1360, height: 900 },
  permissions: ["clipboard-read", "clipboard-write"],
})
const page = await context.newPage()
page.setDefaultTimeout(60_000)
const alertIds = []
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` })

try {
  // --- sign in through the real form, landing on the assistant
  await page.goto(`${base}/login`)
  await page.getByPlaceholder("Correo electrónico").fill(email)
  await page.getByPlaceholder("Contraseña").fill(password)
  await page.getByRole("button", { name: "Entrar" }).click()
  await page.waitForURL(`**/chatbot/${chatbotId}`)
  check("login lands on the assistant", true)

  // --- team-aware shell
  await page.getByRole("heading", { name: chatbot.name, exact: true }).first().waitFor()
  check("sidebar shows the assistant name, not a hard-coded brand", true)
  const welcome = chatbot.welcome_message || ""
  if (welcome) {
    check("empty chat shows the assistant's welcome message", await page.getByText(welcome.slice(0, 40)).first().isVisible())
  }
  const firstPrompt = chatbot.suggested_questions?.[0]?.prompts?.[0]
  check("empty chat shows the assistant's example questions", !!firstPrompt && (await page.getByText(firstPrompt).first().isVisible()))
  await page.getByTestId("knowledge-summary").waitFor()
  check("empty chat summarises the knowledge base", (await page.getByTestId("knowledge-summary").innerText()).includes("documentos"))
  check("disclaimer uses the assistant name", await page.getByText(`${chatbot.name} puede cometer errores`).isVisible())
  await shot("01-empty-chat")

  // --- entity type memory
  const profiles = chatbot.audience_options ?? []
  const hasEntities = profiles.length > 0
  const profile = profiles[0]
  const otherProfile = profiles.find((option) => option !== profile) ?? profile
  if (hasEntities) {
    const prompt = page.getByTestId("entity-prompt")
    await prompt.waitFor()
    check("empty chat asks for the entity type once", await prompt.isVisible())
    await shot("01b-entity-prompt")
    await prompt.getByRole("button", { name: profile, exact: true }).click()
    await page.getByTestId("entity-chip").filter({ hasText: profile }).waitFor()
    check("picking an entity type shows it in the header chip", (await prompt.count()) === 0)
    await page.reload()
    await page.getByTestId("entity-chip").filter({ hasText: profile }).waitFor()
    check("the entity type is remembered after a reload", (await page.getByTestId("entity-prompt").count()) === 0)
  }

  // --- ask a question: stream, sources list, follow-ups
  await page.getByPlaceholder("Escribe tu pregunta...").fill("¿Qué es el Costo Anual Total (CAT) y quién lo regula?")
  await page.getByRole("button", { name: "Enviar" }).click()
  await page.getByRole("button", { name: "Detener respuesta" }).waitFor()
  check("a stop button replaces send while answering", true)
  await page.getByText("Preguntas sugeridas").waitFor({ timeout: 120_000 })
  check("follow-up suggestions appear under the answer", (await page.locator("button:has(svg.lucide-corner-down-right)").count()) >= 1)
  const sourceRows = page.locator("li:has(button[aria-label^='Ver la fuente'])")
  const sourceCount = await sourceRows.count()
  check("sources are listed one per line", sourceCount >= 1, `count=${sourceCount}`)
  const sourcesText = await page.getByText("Fuentes", { exact: true }).first().isVisible()
  check("sources block is in Spanish", sourcesText)
  const chatText = await page.locator("main, body").first().innerText()
  check("the model's own 'Referencias' block is replaced by the sources list", !/Referencias:/.test(chatText) && !chatText.includes("**") && !chatText.includes("References:"), chatText.slice(chatText.indexOf("Referencias") - 20, chatText.indexOf("Referencias") + 80))
  await shot("02-answer")

  // clicking an inline [N] marker highlights the source in the side panel
  await page.locator("button[aria-label^='Fuente ']").first().click()
  check("clicking [N] highlights the passage in the side panel", (await page.locator("[id^='source-'].ring-2").count()) === 1)

  // --- answer actions
  await page.getByRole("button", { name: /Copiar/ }).first().click()
  await page.getByRole("menuitem", { name: "Copiar con fuentes" }).click()
  const copied = await page.evaluate(() => navigator.clipboard.readText())
  check("copy with sources puts answer + Fuentes in the clipboard", copied.includes("Fuentes") && copied.length > 200, copied.slice(0, 100))
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    (async () => {
      await page.getByRole("button", { name: /Copiar/ }).first().click()
      await page.getByRole("menuitem", { name: "Descargar Markdown" }).click()
    })(),
  ])
  check("Markdown download works", download.suggestedFilename().endsWith(".md"), download.suggestedFilename())

  await page.getByRole("button", { name: "Compartir" }).first().click()
  await page.getByText("Enlace copiado", { exact: true }).waitFor()
  const shareUrl = await page.evaluate(() => navigator.clipboard.readText())
  check("share copies a /shared link", /\/shared\/[0-9a-f-]{36}$/.test(shareUrl), shareUrl)
  const sharedPage = await context.newPage()
  await sharedPage.goto(shareUrl)
  await sharedPage.getByText("Conversación compartida").waitFor()
  check("shared link opens for a team member", (await sharedPage.getByText("Costo Anual Total").count()) > 0)
  await sharedPage.screenshot({ path: `${shots}/03-shared.png` })
  await sharedPage.close()

  // --- reload keeps the conversation
  await page.reload()
  await page.getByText("Costo Anual Total").first().waitFor()
  check("reloading restores the conversation with its sources", (await page.locator("button[aria-label^='Ver la fuente']").count()) >= 1)

  // --- document actions on a cited source
  const actionRequests = []
  page.on("request", (req) => {
    if (req.url().endsWith("/api/chat") && req.method() === "POST") actionRequests.push(req.postDataJSON())
  })
  // Documents that only exist in the search index have no Library entry, so
  // this question targets a regular Library document.
  await page.getByRole("button", { name: "Nueva conversación" }).click()
  await page.getByPlaceholder("Escribe tu pregunta...").fill("¿Qué dice la Ley para Regular las Agrupaciones Financieras sobre las sociedades controladoras?")
  await page.getByRole("button", { name: "Enviar" }).click()
  await page.getByText("Preguntas sugeridas").waitFor({ timeout: 120_000 })
  await page.locator("button[aria-label^='Acciones para']").first().waitFor()
  await page.locator("button[aria-label^='Acciones para']").first().click()
  check("each source offers summarize, compare, what-changed and validity", (await page.getByRole("menuitem").count()) === 4)
  await shot("04a-source-actions")
  await page.getByRole("menuitem", { name: "Resumir este documento" }).click()
  await page.getByText(/^Resume el documento «/).waitFor()
  check("summarize sends a focused request for that document", actionRequests.at(-1)?.focus?.action === "summarize" && actionRequests.at(-1).focus.fileIds.length === 1, JSON.stringify(actionRequests.at(-1)?.focus))
  await page.getByText("Preguntas sugeridas").last().waitFor({ timeout: 120_000 })
  const summaryCitations = await page.locator("li:has(button[aria-label^='Ver la fuente'])").count()
  check("the summary is answered with sources", summaryCitations >= 2)
  await shot("04b-summary")
  await page.locator("button[aria-label^='Acciones para']").last().click()
  await page.getByRole("menuitem", { name: "Comparar con otro documento…" }).click()
  const picker = page.getByRole("dialog")
  await picker.getByText("Comparar con otro documento").first().waitFor()
  await picker.getByTestId("document-picker-list").getByRole("button").first().waitFor()
  await shot("04c-compare-picker")
  await picker.getByPlaceholder("Buscar un documento…").fill("zzzz-no-existe")
  check("the picker filters the library by name", (await picker.getByText("No hay documentos que coincidan.").count()) === 1)
  await picker.getByPlaceholder("Buscar un documento…").fill("")
  await picker.getByTestId("document-picker-list").getByRole("button").first().click()
  await page.getByText(/^Compara «/).waitFor()
  check("compare sends the two chosen documents", actionRequests.at(-1)?.focus?.action === "compare" && new Set(actionRequests.at(-1).focus.fileIds).size === 2, JSON.stringify(actionRequests.at(-1)?.focus))
  await page.getByText("Preguntas sugeridas").last().waitFor({ timeout: 120_000 })
  await shot("04d-compare")

  // --- stop and retry
  await page.getByRole("button", { name: "Nueva conversación" }).click()
  await page.getByPlaceholder("Escribe tu pregunta...").fill("Explica con detalle las obligaciones de PLD/FT")
  await page.getByRole("button", { name: "Enviar" }).click()
  await page.getByRole("button", { name: "Detener respuesta" }).waitFor()
  await page.getByRole("button", { name: "Detener respuesta" }).click()
  await page.getByText("Respuesta detenida").waitFor()
  check("stopping shows a notice", true)
  await page.getByRole("button", { name: "Reintentar" }).waitFor()
  check("a stopped answer offers Reintentar", true)
  await shot("04-stopped")
  await page.getByRole("button", { name: "Reintentar" }).click()
  await page.getByText("Preguntas sugeridas").waitFor({ timeout: 120_000 })
  check("Reintentar produces a complete answer", (await page.getByText("Respuesta detenida").count()) === 0)


  // --- research mode with visible progress, then tools on its answer
  await page.getByRole("button", { name: "Nueva conversación" }).click()
  const toggle = page.getByTestId("research-toggle")
  check("the chat offers 'Investigar a fondo' as an opt-in switch", (await toggle.getAttribute("aria-checked")) === "false")
  await toggle.click()
  check("turning it on is visible", (await toggle.getAttribute("aria-checked")) === "true")
  await shot("11a-research-on")
  await page.getByPlaceholder(/pregunta amplia/).fill("Compara las obligaciones de transparencia y de cálculo del CAT para créditos al consumo y tarjetas de crédito")
  await page.getByRole("button", { name: "Enviar" }).click()
  await page.getByTestId("research-steps").first().waitFor({ timeout: 90_000 })
  check("searches are listed while the assistant works", (await page.getByTestId("research-steps").first().getByRole("listitem").count()) >= 2)
  await shot("11b-research-progress")
  await page.getByText("Preguntas sugeridas").waitFor({ timeout: 180_000 })
  await page.getByTestId("research-steps").first().getByText("Cómo investigué").waitFor()
  check("the finished answer keeps a 'Cómo investigué' summary", (await page.getByTestId("research-steps").first().innerText()).includes("documento"))
  check("research switches itself off after the question", (await page.getByTestId("research-toggle").getAttribute("aria-checked")) === "false")
  check("a research answer has sources", (await page.locator("button[aria-label^='Ver la fuente']").count()) >= 1)
  await shot("11c-research-answer")
  await page.reload()
  await page.getByTestId("research-steps").first().waitFor()
  check("the searches survive a reload", true)

  // tools under the answer
  await page.getByTestId("tools-menu").first().click()
  check("the tools menu offers the answer tools", (await page.getByRole("menuitem").count()) === 2)
  await page.getByRole("menuitem", { name: "Redactar correo" }).click()
  const toolDialog = page.getByTestId("tool-dialog")
  await toolDialog.getByRole("button", { name: "Generar" }).click()
  await toolDialog.getByTestId("tool-output").waitFor({ timeout: 120_000 })
  check("'Redactar correo' produces a draft with a subject", (await toolDialog.getByTestId("tool-output").inputValue()).startsWith("Asunto:"))
  await shot("11d-tool-email")
  await toolDialog.getByRole("button", { name: "Copiar" }).click()
  check("the draft can be copied", (await page.evaluate(() => navigator.clipboard.readText())).startsWith("Asunto:"))
  await page.getByTestId("tool-dialog").getByRole("button", { name: "Close" }).click()
  await page.getByTestId("tool-dialog").waitFor({ state: "detached" })
  check("the tool dialog closes with its X button", true)
  await page.locator("button[aria-label^='Acciones para']").first().click()
  await page.getByRole("menuitem", { name: "Verificar vigencia" }).click()
  await page.getByTestId("tool-dialog").getByTestId("tool-output").waitFor({ timeout: 120_000 })
  check("'Verificar vigencia' reports on the document", (await page.getByTestId("tool-output").inputValue()).includes("Lo que dice el documento"))
  await shot("11e-tool-validity")
  await page.keyboard.press("Escape")
  await page.getByTestId("tool-dialog").waitFor({ state: "detached", timeout: 5000 })
  check("the tool dialog closes with Escape", true)

  // --- change alerts: seeded directly so no document is touched
  const { data: pair } = await admin.from("files").select("id, file_name").eq("chatbot_id", chatbotId).or("file_name.ilike.Circular 34/2010%,file_name.ilike.Circular 21/2009%")
  const newDoc = pair.find((f) => f.file_name.startsWith("Circular 34"))
  const oldDoc = pair.find((f) => f.file_name.startsWith("Circular 21"))
  const { data: published } = await admin.from("change_alerts").insert({ chatbot_id: chatbotId, new_file_id: newDoc.id, old_file_id: oldDoc.id, source: "manual", status: "published", published_at: new Date().toISOString(), decided_by: userId }).select("id").single()
  await admin.from("change_alert_recipients").insert({ alert_id: published.id, user_id: userId })
  alertIds.push(published.id)
  await page.getByRole("button", { name: "Nueva conversación" }).click()
  await page.getByTestId("change-alert").waitFor()
  check("a reader is told that a document they saw was replaced", (await page.getByTestId("change-alert").innerText()).includes(newDoc.file_name))
  await shot("12a-change-alert")
  await page.getByTestId("entity-chip").click()
  const switchEl = page.getByTestId("email-alerts-switch")
  check("e-mail notices are off by default", (await switchEl.getAttribute("aria-checked")) === "false")
  await switchEl.click()
  await page.waitForResponse((r) => r.url().includes("/preferences") && r.request().method() === "PUT")
  await page.reload()
  await page.getByTestId("change-alerts").waitFor()
  await page.getByTestId("entity-chip").click()
  await page.getByTestId("email-alerts-switch").waitFor()
  check("opting in to e-mail is remembered", (await page.getByTestId("email-alerts-switch").getAttribute("aria-checked")) === "true")
  check("and stored as an opt-in for this assistant", (await admin.from("assistant_user_prefs").select("email_alerts").eq("user_id", userId).eq("chatbot_id", chatbotId).single()).data?.email_alerts === true)
  await page.getByTestId("email-alerts-switch").click()
  await page.waitForResponse((r) => r.url().includes("/preferences") && r.request().method() === "PUT")
  const compareRequest = page.waitForRequest((r) => r.url().endsWith("/api/chat") && r.method() === "POST")
  await page.getByRole("button", { name: "Ver qué cambió" }).click()
  const compareBody = (await compareRequest).postDataJSON()
  check("'Ver qué cambió' compares the new and the old document", compareBody.focus?.action === "changes" && compareBody.focus.fileIds[0] === newDoc.id && compareBody.focus.fileIds[1] === oldDoc.id, JSON.stringify(compareBody.focus))
  await page.getByText("Preguntas sugeridas").waitFor({ timeout: 180_000 })
  await shot("12b-change-compare")
  await page.getByRole("button", { name: "Nueva conversación" }).click()
  await page.getByTestId("change-alert").waitFor()
  await page.getByRole("button", { name: "Entendido" }).click()
  await page.getByTestId("change-alert").waitFor({ state: "detached" })
  check("a notice can be dismissed", true)

  // --- history: reopen the first conversation and continue it
  await page.getByRole("button", { name: "Historial" }).click()
  await page.getByText("Costo Anual Total").first().waitFor()
  await page.locator("button:has-text('Costo Anual Total')").first().click()
  await page.getByPlaceholder("Escribe tu pregunta...").waitFor()
  check("a conversation from Historial reopens in the chat with its sources", (await page.locator("button[aria-label^='Ver la fuente']").count()) >= 1)
  await shot("05-history-reopened")

  // --- clarifying questions and filter note (server replies are scripted)
  if (hasEntities) {
    const ndjson = (events) => events.map((e) => JSON.stringify(e)).join("\n") + "\n"
    const fulfill = (events) => (route) =>
      route.fulfill({ status: 200, headers: { "content-type": "application/x-ndjson" }, body: ndjson(events) })
    const requests = []
    await page.route("**/api/chat", async (route) => {
      const body = route.request().postDataJSON()
      requests.push(body)
      const plan = scripted.shift()
      await fulfill(plan)(route)
    })
    let scripted = [
      [{ type: "done", id: "resp_fake1", output_text: "¿A qué tipo de operación te refieres?", citations: [], clarify: { question: "¿A qué tipo de operación te refieres?", options: ["Crédito", "Captación"] }, entity_filter: null }],
      [{ type: "done", id: "resp_fake2", output_text: "Respuesta sobre el documento.", citations: [], clarify: null, entity_filter: { applied: true, entity: profile } }],
      [{ type: "done", id: "resp_fake3", output_text: "Respuesta con todos los documentos.", citations: [], clarify: null, entity_filter: { applied: false, entity: profile } }],
    ]
    await page.getByRole("button", { name: "Nueva conversación" }).click()
    await page.getByPlaceholder("Escribe tu pregunta...").fill("¿Cuál es el límite?")
    await page.getByRole("button", { name: "Enviar" }).click()
    const options = page.getByTestId("clarify-options")
    await options.waitFor()
    check("an ambiguous question shows its options as buttons", (await options.getByRole("button").count()) === 2)
    check("the clarifying question is plain text without actions", (await page.getByTestId("clarify-question").count()) === 1)
    await shot("08-clarify")
    await options.getByRole("button", { name: "Crédito" }).click()
    await page.getByText("Respuesta sobre el documento.").waitFor()
    check("clicking an option sends it as the user's message", requests[1]?.query?.[0]?.content === "Crédito", JSON.stringify(requests[1]?.query))
    check("the option buttons disappear after answering", (await page.getByTestId("clarify-options").count()) === 0)
    const note = page.getByTestId("entity-filter-note")
    await note.waitFor()
    check("a filtered answer says which documents were searched", (await note.innerText()).includes(profile))
    await shot("09-filter-note")
    await note.getByRole("button", { name: "Buscar en todos los documentos" }).click()
    await page.getByText("Respuesta con todos los documentos.").waitFor()
    check("'search all documents' repeats the question without the filter", requests[2]?.useEntityFilter === false && requests[2]?.query?.[0]?.content === "¿Cuál es el límite? (Crédito)", JSON.stringify(requests[2]))
    check("the filter note is gone once everything was searched", (await page.getByTestId("entity-filter-note").count()) === 0)

    // choosing an entity type from a clarifying question saves it
    await page.getByTestId("entity-chip").click()
    await page.getByRole("menuitem", { name: "Olvidar mi perfil" }).click()
    await page.getByTestId("entity-chip").filter({ hasText: "Perfil" }).waitFor()
    check("the entity type can be forgotten from the header", true)
    scripted = [
      [{ type: "done", id: "resp_fake4", output_text: "¿Qué tipo de entidad eres?", citations: [], clarify: { question: "¿Qué tipo de entidad eres?", options: chatbot.audience_options, kind: "entity_type" }, entity_filter: null }],
      [{ type: "done", id: "resp_fake5", output_text: "Listo.", citations: [], clarify: null, entity_filter: null }],
    ]
    await page.getByRole("button", { name: "Nueva conversación" }).click()
    await page.getByPlaceholder("Escribe tu pregunta...").fill("¿Qué cubre este documento?")
    await page.getByRole("button", { name: "Enviar" }).click()
    await page.getByTestId("clarify-options").getByRole("button", { name: otherProfile, exact: true }).click()
    await page.getByText("Listo.").waitFor()
    await page.getByTestId("entity-chip").filter({ hasText: otherProfile }).waitFor()
    check("answering an entity-type question saves the entity type", true)
    await page.unroute("**/api/chat")
  }

  // --- admin: audience of the documents
  if (hasEntities) {
    await page.getByRole("button", { name: "Biblioteca" }).click()
    const panel = page.getByTestId("audience-panel")
    await panel.waitFor()
    check("Biblioteca shows the audience panel to admins", (await panel.innerText()).includes("confirmados"))
    check("the panel offers tags import, AI suggestions and accepting them", (await panel.getByRole("button").count()) === 3)
    await page.getByRole("button", { name: "Editar audiencia" }).first().click()
    await page.getByRole("dialog").getByText("Audiencia del documento").waitFor()
    check("a document's audience can be edited with one checkbox per entity type", (await page.getByRole("dialog").getByRole("checkbox").count()) === chatbot.audience_options.length)
    await shot("10-audience-dialog")
    await page.keyboard.press("Escape")
    await shot("10b-library-audience")
    await page.getByRole("button", { name: "Asistente" }).click()
    const typesBox = page.getByLabel("Perfiles de audiencia")
    check("Asistente lists the entity types and the filter switch", (await typesBox.inputValue()).split("\n").length === chatbot.audience_options.length && (await page.getByRole("switch").count()) === 2)
    await page.getByRole("button", { name: "Chat" }).first().click()
  }


  // --- admin: change alerts panel (pending suggestion seeded directly)
  const { data: pending } = await admin.from("change_alerts").insert({ chatbot_id: chatbotId, new_file_id: newDoc.id, old_file_id: (await admin.from("files").select("id").eq("chatbot_id", chatbotId).ilike("file_name", "Ley para Regular las Agrupaciones%").limit(1).single()).data.id, source: "detected", status: "pending", score: 0.82 }).select("id").single()
  alertIds.push(pending.id)
  await page.getByRole("button", { name: "Biblioteca" }).click()
  const alertsPanel = page.getByTestId("change-alerts-panel")
  await alertsPanel.waitFor()
  await alertsPanel.getByText(/1 posible reemplazo/).waitFor({ timeout: 15_000 }).catch(() => undefined)
  check("Biblioteca shows how many replacements await review", (await alertsPanel.innerText()).includes("1 posible reemplazo"))
  await alertsPanel.getByRole("button").first().click()
  check("the suggestion names both documents and its similarity", (await page.getByTestId("pending-alerts").innerText()).includes("82%"))
  check("a replacement can also be declared by hand", (await alertsPanel.getByLabel("Documento nuevo").count()) === 1)
  await shot("12c-alerts-panel")
  await alertsPanel.getByRole("button", { name: "Confirmar reemplazo" }).click()
  await page.getByTestId("alert-audience").waitFor()
  check("confirming shows who will be told before anything happens", /persona/.test(await page.getByTestId("alert-audience").innerText()))
  await shot("12d-alert-confirm")
  await page.keyboard.press("Escape")
  await alertsPanel.getByRole("button", { name: "No es un reemplazo" }).click()
  await page.getByText("Sugerencia descartada.", { exact: true }).waitFor()
  check("a suggestion can be dismissed", true)
  await page.getByRole("button", { name: "Chat" }).first().click()

  // --- admin: library health, feedback and team screens
  await page.getByRole("button", { name: "Biblioteca" }).click()
  const healthPanel = page.getByTestId("library-health")
  await healthPanel.waitFor()
  check("Biblioteca shows the health panel with the totals", /documentos · \d+ listos/.test(await healthPanel.innerText()))
  await healthPanel.getByRole("button").first().click()
  check("the health panel lists what needs fixing", (await healthPanel.getByRole("listitem").count()) >= 1)
  await shot("10c-library-health")
  await page.getByRole("button", { name: "Retroalimentación" }).click()
  await page.getByRole("heading", { name: "Retroalimentación" }).waitFor()
  check("Retroalimentación has rating and status filters", (await page.getByRole("button", { name: "Pendientes" }).count()) === 1)
  await shot("10d-feedback")
  await page.getByRole("button", { name: "Miembros" }).click()
  await page.getByText("Miembros del equipo").first().waitFor().catch(() => undefined)
  await shot("10e-team")
  await page.getByRole("button", { name: "Chat" }).first().click()

  // --- admin: edit the assistant's welcome text
  await page.getByRole("button", { name: "Asistente" }).click()
  const newWelcome = `Bienvenido (prueba ${Date.now()})`
  await page.getByLabel("Mensaje de bienvenida").fill(newWelcome)
  const features = page.getByTestId("agent-features")
  check("Asistente has the research switch and the three tools", (await features.getByRole("checkbox").count()) === 3 && (await features.getByRole("switch").count()) === 1)
  check("admins see the tool audit log", (await page.getByTestId("tool-runs").innerText()).includes("Registro de uso"))
  await shot("11f-settings-tools")
  await page.getByRole("button", { name: "Guardar cambios" }).click()
  await page.getByText("Cambios guardados.", { exact: true }).waitFor()
  await page.getByRole("button", { name: "Chat" }).first().click()
  await page.getByRole("button", { name: "Nueva conversación" }).click()
  check("edited welcome message shows in the chat", await page.getByText(newWelcome).isVisible())
  await shot("06-settings-applied")

  // --- navigation only offers working screens
  check("Evaluaciones (legacy) is not in the menu", (await page.getByRole("button", { name: "Evaluaciones" }).count()) === 0)

  // --- mobile
  await page.setViewportSize({ width: 390, height: 800 })
  await page.reload()
  await page.getByPlaceholder("Escribe tu pregunta...").waitFor()
  await shot("07-mobile")
  check("chat renders on a phone-sized screen", true)
} catch (error) {
  failed++
  console.error("FAIL  unexpected error:", error)
  await shot("zz-failure").catch(() => undefined)
} finally {
  await browser.close()
  await admin.from("chatbots").update({ welcome_message: chatbot.welcome_message }).eq("id", chatbotId)
  if (alertIds.length) await admin.from("change_alerts").delete().in("id", alertIds)
  await admin.from("tool_runs").delete().eq("user_id", userId)
  await admin.from("conversation_shares").delete().eq("user_id", userId)
  await admin.from("answer_ratings").delete().eq("user_id", userId)
  await admin.from("chat_messages").delete().eq("user_id", userId)
  await admin.from("assistant_user_prefs").delete().eq("user_id", userId)
  await admin.from("team_members").delete().eq("user_id", userId)
  await admin.auth.admin.deleteUser(userId)
  console.log("cleanup done; screenshots in", shots)
  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed ? 1 : 0)
}

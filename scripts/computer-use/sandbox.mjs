import vm from "node:vm"

import { chromium } from "playwright"

const VIEWPORT = { width: 1440, height: 900 }
const EXEC_TIMEOUT_MS = 25_000
const MAX_CODE_CHARS = 20_000

const sessions = new Map()

function chromePath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH
  return "/usr/local/bin/google-chrome"
}

/**
 * Loopback only. The production app host is refused even if a caller tries to
 * widen the list. data/blob/about are the browser's own URLs, not the network.
 */
export function requestAllowed(rawUrl) {
  let url
  try {
    url = new URL(rawUrl)
  } catch {
    return false
  }
  if (url.protocol === "about:" || url.protocol === "blob:" || url.protocol === "data:") {
    return true
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false
  const host = url.hostname.replace(/^\[|\]$/g, "")
  return host === "localhost" || host === "127.0.0.1" || host === "::1"
}

function redact(text) {
  const keyShape = new RegExp(["sk", "[A-Za-z0-9_-]+"].join("-"), "g")
  return String(text).replace(keyShape, "[redacted]").slice(0, 4000)
}

function stringify(value) {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function getSession(sessionId) {
  const existing = sessions.get(sessionId)
  if (existing) return existing

  const browser = await chromium.launch({
    executablePath: chromePath(),
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  })
  const context = await browser.newContext({ viewport: VIEWPORT })
  await context.route("**/*", (route) => {
    if (requestAllowed(route.request().url())) route.continue()
    else route.abort("blockedbyclient")
  })
  const page = await context.newPage()
  page.setDefaultTimeout(EXEC_TIMEOUT_MS)
  const realm = vm.createContext({
    URL,
    Promise,
    Math,
    Date,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    Map,
    Set,
    Symbol,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
  })
  const session = { browser, context, page, realm }
  sessions.set(sessionId, session)
  return session
}

function normalizeImage(value) {
  if (!value) return null
  if (Buffer.isBuffer(value)) return value.toString("base64")
  const text = String(value).trim()
  const match = /^data:image\/png;base64,(.+)$/i.exec(text)
  const raw = (match ? match[1] : text).replace(/\s/g, "")
  if (!/^[A-Za-z0-9+/]+=*$/.test(raw) || raw.length < 32) return null
  return raw
}

/**
 * Runs JavaScript in one persistent browser. `browser`, `context`, `page`,
 * `console.log`, and `display` match the computer-use tool description.
 * Variables stored on the realm survive later calls for the same session id.
 */
export async function executeInSandbox(code, sessionId) {
  if (typeof code !== "string" || !code.trim()) {
    return [{ type: "input_text", text: "exec_js requires code." }]
  }
  if (code.length > MAX_CODE_CHARS) {
    return [{ type: "input_text", text: "exec_js refused: code is too long." }]
  }

  const session = await getSession(sessionId)
  const logs = []
  const images = []
  const sandboxConsole = {
    log: (...args) => {
      logs.push(redact(args.map(stringify).join(" ")))
    },
  }
  const display = (image) => {
    const raw = normalizeImage(image)
    if (raw) images.push(raw)
    else logs.push("display() needs a PNG base64 string.")
  }

  session.realm.browser = session.browser
  session.realm.context = session.context
  session.realm.page = session.page
  session.realm.console = sandboxConsole
  session.realm.display = display

  const wrapped = `(async () => {\n${code}\n})()`
  let timer
  try {
    const running = vm.runInContext(wrapped, session.realm, { timeout: EXEC_TIMEOUT_MS })
    const result = await Promise.race([
      running,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("exec_js timed out")), EXEC_TIMEOUT_MS)
      }),
    ])
    if (result !== undefined) logs.push(redact(stringify(result)))
  } catch (error) {
    logs.push(redact(`Error: ${error instanceof Error ? error.message : String(error)}`))
  } finally {
    clearTimeout(timer)
  }

  if (images.length === 0) {
    try {
      const png = await session.page.screenshot({ type: "png" })
      images.push(png.toString("base64"))
    } catch (error) {
      logs.push(redact(`Screenshot failed: ${error instanceof Error ? error.message : String(error)}`))
    }
  }

  const output = []
  for (const text of logs) output.push({ type: "input_text", text })
  for (const image of images) {
    output.push({
      type: "input_image",
      image_url: `data:image/png;base64,${image}`,
      detail: "original",
    })
  }
  if (output.length === 0) output.push({ type: "input_text", text: "No output." })
  return output
}

export async function closeSandbox(sessionId) {
  const session = sessions.get(sessionId)
  if (!session) return
  sessions.delete(sessionId)
  await session.context.close().catch(() => undefined)
  await session.browser.close().catch(() => undefined)
}

export async function closeAllSandboxes() {
  const ids = Array.from(sessions.keys())
  for (const id of ids) await closeSandbox(id)
}

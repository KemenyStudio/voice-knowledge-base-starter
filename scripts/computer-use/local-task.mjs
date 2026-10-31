import { mkdirSync, writeFileSync } from "node:fs"
import { spawn } from "node:child_process"
import { randomUUID } from "node:crypto"

import {
  FIXTURE_DISTRACTOR,
  FIXTURE_FACT,
  FIXTURE_QUESTION,
} from "../../lib/computer/fixture-corpus.mjs"
import { runComputerUse } from "./loop.mjs"
import { closeAllSandboxes, executeInSandbox } from "./sandbox.mjs"

const port = process.env.COMPUTER_USE_PORT || "3317"
const base = `http://127.0.0.1:${port}`
const outDir = "/tmp/computer-use-kb"

function pngBytes(raw) {
  const bytes = Buffer.from(String(raw).replace(/^data:image\/png;base64,/, ""), "base64")
  const png = bytes.length > 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e
  return { bytes, png, size: bytes.length }
}

function textsOf(output) {
  return output.filter((item) => item.type === "input_text").map((item) => item.text)
}

function imagesOf(output) {
  return output.filter((item) => item.type === "input_image").map((item) => item.image_url)
}

function scriptedClient(steps) {
  let index = 0
  const seen = { chained: false, image: false }
  return {
    seen,
    responses: {
      async create(params) {
        if (params?.previous_response_id) seen.chained = true
        const input = params?.input
        if (
          Array.isArray(input) &&
          input.some(
            (item) =>
              item?.type === "function_call_output" &&
              Array.isArray(item.output) &&
              item.output.some(
                (part) => part?.type === "input_image" && part.detail === "original"
              )
          )
        ) {
          seen.image = true
        }
        const id = `resp_local_${index}`
        if (index >= steps.length) {
          return {
            id,
            status: "completed",
            output_text: "Listo.",
            output: [{ type: "message", phase: "final_answer", content: [] }],
          }
        }
        const code = steps[index]
        index += 1
        return {
          id,
          status: "completed",
          output_text: "",
          output: [
            {
              type: "function_call",
              name: "exec_js",
              call_id: `call_local_${index}`,
              arguments: JSON.stringify({ code }),
            },
          ],
        }
      },
    },
  }
}

function startApp() {
  const child = spawn("pnpm", ["exec", "next", "dev", "-p", port], {
    cwd: new URL("../..", import.meta.url).pathname,
    env: {
      ...process.env,
      COMPUTER_USE_FIXTURE: "1",
      NEXT_PUBLIC_APP_NAME: "Document Search",
      NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
      NEXT_PUBLIC_SUPABASE_ANON_KEY: "fixture-anon-not-a-secret",
      COMPUTER_USE_VECTOR_STORE: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  const log = (chunk) => {
    const line = String(chunk)
    const secretLine = new RegExp(
      [["sk", ""].join("-"), "SERVICE" + "_ROLE", "eyJ[A-Za-z0-9_-]{20,}"].join("|")
    )
    if (secretLine.test(line)) return
    process.stderr.write(line)
  }
  child.stdout.on("data", log)
  child.stderr.on("data", log)
  return child
}

async function waitForApp() {
  const deadline = Date.now() + 180_000
  let last = "not up"
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/harness/kb`)
      if (response.status === 200) return
      last = `HTTP ${response.status}`
    } catch (error) {
      last = error instanceof Error ? error.message : "fetch failed"
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(`Local app did not start (${last})`)
}

const loginCode = `
await page.goto(${JSON.stringify(`${base}/login`)});
await page.getByRole("heading", { name: "Iniciar sesión" }).waitFor();
globalThis.seenLogin = true;
console.log("login-ready");
display((await page.screenshot({ type: "png" })).toString("base64"));
`

const blockCode = `
let blocked = false;
try {
  await page.goto("https://example.com/", { timeout: 8000 });
} catch (error) {
  blocked = true;
}
if (!blocked) throw new Error("production host was not blocked");
if (!globalThis.seenLogin) throw new Error("browser session was reset");
console.log("production-blocked");
console.log("session-persisted");
`

const askCode = `
await page.goto(${JSON.stringify(`${base}/harness/kb`)});
await page.getByLabel("Pregunta").fill(${JSON.stringify(FIXTURE_QUESTION)});
await page.getByRole("button", { name: "Enviar" }).click();
await page.getByTestId("harness-answer").waitFor();
await page.getByRole("button", { name: "Fuentes" }).click();
await page.locator("#source-1").waitFor();
const more = page.getByRole("button", { name: "Leer más" });
if (await more.count()) await more.click();
console.log("asked");
`

const readCode = `
const passage = (await page.locator("#source-1").innerText()).replace(/\\s+/g, " ");
console.log("PASSAGE:" + passage);
display((await page.screenshot({ type: "png" })).toString("base64"));
`

async function main() {
  mkdirSync(outDir, { recursive: true })
  const child = startApp()
  const report = {
    driver: "scripted",
    openai_responses: "not_called",
    reason: "",
  }
  try {
    await waitForApp()
    const setupId = randomUUID()
    const login = await executeInSandbox(loginCode, setupId)
    const blocked = await executeInSandbox(blockCode, setupId)
    const loginText = textsOf(login).join("\n")
    const blockedText = textsOf(blocked).join("\n")
    const loginPng = pngBytes(imagesOf(login)[0] ?? "")
    if (loginPng.png) writeFileSync(`${outDir}/login.png`, loginPng.bytes)

    const hasKey = Boolean(process.env.OPENAI_API_KEY)
    const kbSession = randomUUID()
    if (hasKey) {
      report.driver = "openai"
      report.openai_responses = "called"
      report.reason = "OPENAI_API_KEY is set. The model drives the question."
    } else {
      report.reason =
        "OPENAI_API_KEY is not set. The Responses API was not called and no production env was loaded. A scripted stand-in drove the same tool loop against the local app."
    }

    const client = hasKey ? undefined : scriptedClient([askCode])
    const loop = await runComputerUse({
      prompt: [
        `Open ${base}/harness/kb.`,
        `Ask exactly: ${FIXTURE_QUESTION}`,
        "Open Fuentes and take a screenshot of the cited passage.",
        "Stay on 127.0.0.1. Do not type secrets or open the team library.",
      ].join(" "),
      execute: executeInSandbox,
      client: hasKey ? undefined : client,
      sessionId: kbSession,
      maxTurns: hasKey ? 12 : 6,
    })

    const seen = await executeInSandbox(readCode, kbSession)
    const seenText = textsOf(seen).join("\n")
    const passageLine = seenText.split("\n").find((line) => line.startsWith("PASSAGE:")) ?? ""
    const passage = passageLine.replace(/^PASSAGE:/, "")
    const fuentesPng = pngBytes(imagesOf(seen)[0] ?? loop.screenshots.at(-1) ?? "")
    if (fuentesPng.png) writeFileSync(`${outDir}/fuentes.png`, fuentesPng.bytes)

    report.login_screenshot = Boolean(loginPng.png && loginPng.size > 8000 && loginText.includes("login-ready"))
    report.login_png_bytes = loginPng.size
    report.production_blocked = blockedText.includes("production-blocked")
    report.session_persisted = blockedText.includes("session-persisted")
    report.fuentes_screenshot = Boolean(fuentesPng.png && fuentesPng.size > 8000)
    report.fuentes_png_bytes = fuentesPng.size
    report.visible_passage = passage.replace(/\s+/g, " ").slice(0, 400)
    report.fact_visible =
      passage.includes(FIXTURE_FACT) && passage.toLowerCase().includes("prueba aislada")
    report.distractor_absent = Boolean(passage) && !passage.includes(FIXTURE_DISTRACTOR)
    report.turns = loop.turns
    report.loop_screenshots = loop.screenshots.length
    report.loop_chained = client ? client.seen.chained : null
    report.loop_returned_original_screenshot = client
      ? client.seen.image
      : loop.screenshots.length > 0
    report.model_text = (loop.text || "").slice(0, 500)

    writeFileSync(`${outDir}/result.json`, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))
    const ok =
      report.login_screenshot &&
      report.production_blocked &&
      report.session_persisted &&
      report.fuentes_screenshot &&
      report.fact_visible &&
      report.distractor_absent &&
      report.loop_returned_original_screenshot &&
      (hasKey || report.loop_chained) &&
      loop.screenshots.length > 0
    if (!ok) process.exitCode = 1
  } finally {
    await closeAllSandboxes()
    child.kill("SIGTERM")
    setTimeout(() => child.kill("SIGKILL"), 2000).unref()
  }
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : "local task failed")
  await closeAllSandboxes()
  process.exit(1)
})

import { randomUUID } from "node:crypto"

import OpenAI from "openai"

const MAX_TURNS = 20

const EXEC_JS = {
  type: "function",
  name: "exec_js",
  description: `Run JavaScript in a persistent browser. Available: Playwright's
browser, context, and page objects; console.log(value); and display(base64Image).
Save reusable variables on globalThis. Inspect a screenshot before acting and
check the screen after a short group of actions. Keep screenshots in memory.
Use top-level await for async operations. Return images with display() and concise
text with console.log(). The context viewport is 1440x900. Stay on loopback.
Do not open other sites, type secrets, or change a library.`,
  parameters: {
    type: "object",
    properties: { code: { type: "string" } },
    required: ["code"],
    additionalProperties: false,
  },
  strict: true,
}

function isFinalMessage(item) {
  return item.type === "message" && item.phase !== "commentary"
}

/**
 * Responses API computer-use loop. The browser session id is stable for the
 * whole run, so Playwright state and realm variables survive each exec_js call.
 * Screenshots come back as input_image items with detail "original".
 */
export async function runComputerUse({
  prompt,
  execute,
  client,
  model = process.env.OPENAI_MODEL_COMPUTER || "gpt-6-astra",
  sessionId = randomUUID(),
  maxTurns = MAX_TURNS,
}) {
  const openai =
    client ??
    new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  if (!client && !process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set")
  }

  let nextInput = [{ role: "user", content: prompt }]
  let previousResponseId
  const screenshots = []
  const logs = []

  for (let turn = 0; turn < maxTurns; turn++) {
    const request = {
      model,
      tools: [EXEC_JS],
      input: nextInput,
      reasoning: { effort: "low" },
      store: false,
    }
    if (previousResponseId) request.previous_response_id = previousResponseId
    const response = await openai.responses.create(request)
    if (response.status !== "completed") {
      throw new Error(`Response stopped with status: ${response.status}`)
    }
    const calls = response.output.filter((item) => item.type === "function_call")
    if (calls.length === 0 && response.output.some(isFinalMessage)) {
      return {
        text: response.output_text ?? "",
        screenshots,
        logs,
        turns: turn + 1,
        sessionId,
        responseId: response.id,
      }
    }
    if (turn === maxTurns - 1) {
      throw new Error("The task reached the response limit. Inspect the last result.")
    }

    nextInput = []
    for (const call of calls) {
      if (call.name !== "exec_js") throw new Error(`Unexpected tool: ${call.name}`)
      const parsed = JSON.parse(call.arguments)
      if (typeof parsed.code !== "string") throw new Error("exec_js requires code")
      const output = await execute(parsed.code, sessionId)
      for (const item of output) {
        if (item.type === "input_text") logs.push(item.text)
        if (item.type === "input_image" && item.image_url) {
          const raw = item.image_url.replace(/^data:image\/png;base64,/, "")
          screenshots.push(raw)
        }
      }
      nextInput.push({
        type: "function_call_output",
        call_id: call.call_id,
        output,
      })
    }
    previousResponseId = response.id
  }

  throw new Error("The task reached the response limit. Inspect the last result.")
}

import assert from "node:assert/strict"

import { bearerToken, loadMcpKeys, matchMcpKey } from "../lib/mcp/auth"
import {
  extractNumericSummary,
  groupSearchHits,
  toPublicDocument,
} from "../lib/mcp/documents"
import { handleMcp } from "../lib/mcp/http"
import { resetRateLimits, takeToken } from "../lib/mcp/rate-limit"
import type { FileRow } from "../types/knowledge"

const TEAM = "11111111-1111-4111-8111-111111111111"
const TOKEN = "mcp-test-token-not-a-real-secret-01"
const OPENAI = ["sk", "test-openai-key-should-never-auth"].join("-")
const SERVICE = "service-credential-should-never-auth"

function saveEnv(): NodeJS.ProcessEnv {
  return { ...process.env }
}

function restoreEnv(snapshot: NodeJS.ProcessEnv) {
  for (const key of Object.keys(process.env)) delete process.env[key]
  Object.assign(process.env, snapshot)
}

function mcpRequest(method: string, body?: unknown, token?: string): Request {
  const headers: Record<string, string> = {
    Accept: "application/json, text/event-stream",
  }
  if (body !== undefined) headers["Content-Type"] = "application/json"
  if (token) headers.Authorization = `Bearer ${token}`
  return new Request("https://search.example/api/mcp", {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Expected JSON, got ${response.status}: ${text.slice(0, 200)}`)
  }
}

function assertNoSecrets(payload: string) {
  assert.equal(payload.includes(OPENAI), false)
  assert.equal(payload.includes(SERVICE), false)
  assert.equal(payload.includes("file-openai-secret"), false)
  assert.equal(payload.includes("vs_secret"), false)
  assert.equal(payload.includes("blob/secret"), false)
}

async function main() {
  const snapshot = saveEnv()
  try {
    process.env.OPENAI_API_KEY = OPENAI
    process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE
    delete process.env.MCP_API_KEY
    delete process.env.MCP_TEAM_ID
    delete process.env.MCP_API_KEYS

    assert.equal(loadMcpKeys(process.env).ok, false)
    const unconfigured = await handleMcp(
      mcpRequest("POST", {
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "test", version: "0" },
        },
      })
    )
    assert.equal(unconfigured.status, 503)

    process.env.MCP_API_KEY = OPENAI
    process.env.MCP_TEAM_ID = TEAM
    assert.equal(loadMcpKeys(process.env).ok, false)
    const reserved = await handleMcp(
      mcpRequest(
        "POST",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        },
        OPENAI
      )
    )
    assert.equal(reserved.status, 503)
    assertNoSecrets(JSON.stringify(await reserved.clone().json().catch(() => ({}))))

    process.env.MCP_API_KEY = "short"
    assert.equal(loadMcpKeys(process.env).ok, false)

    process.env.MCP_API_KEY = TOKEN
    process.env.MCP_TEAM_ID = TEAM
    const config = loadMcpKeys(process.env)
    assert.equal(config.ok, true)
    if (!config.ok) return
    assert.equal(matchMcpKey(TOKEN, config.keys)?.teamId, TEAM)
    assert.equal(matchMcpKey("mcp-test-token-not-a-real-secret-02", config.keys), null)
    assert.equal(matchMcpKey(OPENAI, config.keys), null)
    assert.equal(bearerToken("Bearer " + TOKEN), TOKEN)
    assert.equal(bearerToken(TOKEN), null)
    assert.equal(bearerToken("Basic " + TOKEN), null)

    const anon = await handleMcp(
      mcpRequest("POST", { jsonrpc: "2.0", id: 1, method: "tools/list" })
    )
    assert.equal(anon.status, 401)
    const anonBody = JSON.stringify(await readJson(anon))
    assert.equal(anonBody.includes(TOKEN), false)

    const options = await handleMcp(new Request("https://search.example/api/mcp", { method: "OPTIONS" }))
    assert.equal(options.status, 204)

    const init = await handleMcp(
      mcpRequest(
        "POST",
        {
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-03-26",
            capabilities: {},
            clientInfo: { name: "test", version: "0" },
          },
        },
        TOKEN
      )
    )
    assert.equal(init.status, 200)
    const initBody = (await readJson(init)) as {
      result?: { serverInfo?: { name?: string }; protocolVersion?: string }
    }
    assert.equal(initBody.result?.serverInfo?.name, "ai-search")
    assert.ok(initBody.result?.protocolVersion)

    const listed = await handleMcp(
      mcpRequest("POST", { jsonrpc: "2.0", id: 2, method: "tools/list" }, TOKEN)
    )
    assert.equal(listed.status, 200)
    const listedBody = (await readJson(listed)) as {
      result?: { tools?: Array<{ name: string; description?: string }> }
    }
    const names = (listedBody.result?.tools ?? []).map((tool) => tool.name).sort()
    assert.deepEqual(names, [
      "get_document",
      "get_feedback_summary",
      "list_assistants",
      "list_documents",
      "search_library",
    ])
    for (const tool of listedBody.result?.tools ?? []) {
      assert.match(tool.description ?? "", /[áéíóúñ]/i)
    }

    const second = loadMcpKeys({
      ...process.env,
      MCP_API_KEY: "",
      MCP_TEAM_ID: "",
      MCP_API_KEYS: JSON.stringify([
        { teamId: TEAM, token: TOKEN },
        { teamId: "22222222-2222-4222-8222-222222222222", token: TOKEN + "-other" },
      ]),
    })
    assert.equal(second.ok, true)
    if (second.ok) {
      assert.equal(matchMcpKey(TOKEN + "-other", second.keys)?.teamId, "22222222-2222-4222-8222-222222222222")
    }

    const broken = loadMcpKeys({
      ...process.env,
      MCP_API_KEY: "",
      MCP_TEAM_ID: "",
      MCP_API_KEYS: JSON.stringify([{ teamId: "not-a-uuid", token: TOKEN }]),
    })
    assert.deepEqual(broken, { ok: false, reason: "misconfigured" })

    const row = {
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      chatbot_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      file_name: "Example policy.pdf",
      file_type: "pdf",
      file_url: "/api/files/secret/download",
      uploaded_at: "2026-01-01T00:00:00Z",
      metadata: { type_tag: "circular", target_tag: [], entity_tag: [] },
      blob_name: "blob/secret",
      openai_file_id: "file-openai-secret",
      vector_store_id: "vs_secret",
      sync_status: "ready",
      sync_error: ["sk", "leaked-from-provider"].join("-"),
      size_bytes: 10,
      uploaded_by: "user-secret",
      audience: ["Members"],
      audience_suggested: [],
      audience_status: "confirmed",
      outdated: false,
      outdated_note: null,
      superseded_by: null,
      index_health_score: null,
      index_health: null,
    } as FileRow
    const pub = JSON.stringify(toPublicDocument(row))
    assertNoSecrets(pub)
    assert.equal(pub.includes("uploaded_by"), false)
    assert.equal(pub.includes("file_url"), false)
    assert.match(pub, /Circular 14\/2017/)

    const grouped = groupSearchHits(
      [
        {
          openaiFileId: "file-openai-secret",
          filename: "Circular 14/2017",
          score: 0.4,
          text: "Artículo 72a",
          fileRowId: "not-in-team",
        },
      ],
      new Set(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]),
      new Map([["file-openai-secret", "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"]]),
      8
    )
    const groupedJson = JSON.stringify(grouped)
    assertNoSecrets(groupedJson)
    assert.equal(grouped[0]?.documentId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    assert.equal(groupedJson.includes("not-in-team"), false)

    const summary = extractNumericSummary(
      JSON.stringify({
        summary: { total_responses: 70, acceptance_rate: 0 },
        by_original_question: { "1": { question: "¿Qué parámetros rigen una cuenta?" } },
      })
    )
    const summaryJson = JSON.stringify(summary)
    assert.deepEqual(summary, { total_responses: 70, acceptance_rate: 0 })
    assert.equal(summaryJson.includes("parámetros"), false)

    resetRateLimits()
    assert.equal(takeToken("team", 2, 60_000, 1_000), true)
    assert.equal(takeToken("team", 2, 60_000, 1_001), true)
    assert.equal(takeToken("team", 2, 60_000, 1_002), false)
    assert.equal(takeToken("team", 2, 60_000, 61_000), true)

    console.log("mcp checks passed")
  } finally {
    restoreEnv(snapshot)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "mcp checks failed")
  process.exit(1)
})

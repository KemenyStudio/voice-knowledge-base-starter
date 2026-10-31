// Config snapshot for the infraestructura page. No secret values may appear.
//   node scripts/test-infra.mjs
import assert from "node:assert/strict"
import { register } from "node:module"

register(new URL("./resolve-alias.mjs", import.meta.url).href)

const { buildInfraStatus, publicModelId } = await import("../lib/infra/status.ts")

const OPENAI = ["sk", "live-this-should-never-appear-in-json-99"].join("-")
const SERVICE = "service-credential-should-never-appear-in-json"
const ANON = "sb_anon_key_should_never_appear_in_the_page_01"
const RESEND = ["re", "resend_key_should_never_appear_in_page"].join("_")
const MCP = "mcp-token-value-should-not-leak-01"
const TEAM = "11111111-1111-4111-8111-111111111111"
const STORE = "vs_secretstoreidshouldnotshow"

const status = buildInfraStatus({
  VERCEL: "1",
  VERCEL_ENV: "production",
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  EMAIL_FROM: "Document Search <onboarding@example.com>",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
  SUPABASE_STORAGE_BUCKET: "knowledge",
  OPENAI_API_KEY: OPENAI,
  OPENAI_MODEL_ANSWER: OPENAI,
  OPENAI_MODEL_METADATA: "gpt-6-astra",
  OPENAI_REALTIME_MODEL: "gpt-realtime-2.1",
  OPENAI_REALTIME_VOICE: "marin",
  RESEND_API_KEY: RESEND,
  MCP_API_KEY: MCP,
  MCP_TEAM_ID: TEAM,
  COMPUTER_USE_VECTOR_STORE: STORE,
})

const json = JSON.stringify(status)
for (const secret of [OPENAI, SERVICE, ANON, RESEND, MCP, TEAM, STORE, "supabase.co"]) {
  assert.equal(json.includes(secret), false, secret)
}

assert.equal(publicModelId(OPENAI, "gpt-6-luna"), "gpt-6-luna")
assert.equal(publicModelId("gpt-6-luna", "gpt-6-luna"), "gpt-6-luna")

const byId = Object.fromEntries(status.connections.map((row) => [row.id, row]))
assert.equal(byId.vercel.status, "present")
assert.equal(byId.supabase.status, "present")
assert.equal(json.includes("Proyecto de Supabase"), true)
assert.equal(json.includes("abcdefghijklmnopqrst"), false)
assert.equal(json.includes("knowledge"), true)
assert.equal(byId.openai.status, "present")
assert.equal(json.includes("gpt-6-luna"), true)
assert.equal(json.includes("gpt-6-astra"), true)
assert.equal(json.includes("gpt-realtime-2.1"), true)
assert.equal(json.includes("gpt-4o-transcribe"), true)
assert.equal(json.includes("marin"), true)
assert.equal(byId.resend.status, "present")
assert.equal(json.includes("onboarding@example.com"), true)
assert.equal(byId.mcp.status, "present")
assert.equal(json.includes("1 equipo"), true)
assert.equal(json.includes("apagado en esta instancia"), true)
assert.equal(json.includes("índice aislado"), true)

const empty = buildInfraStatus({})
const emptyJson = JSON.stringify(empty)
assert.equal(empty.connections.find((row) => row.id === "openai").status, "missing")
assert.equal(empty.connections.find((row) => row.id === "resend").status, "missing")
assert.equal(empty.connections.find((row) => row.id === "mcp").status, "missing")
assert.equal(empty.connections.find((row) => row.id === "supabase").status, "missing")
assert.equal(empty.connections.find((row) => row.id === "vercel").status, "missing")
assert.equal(emptyJson.includes("gpt-6-luna"), true)

const broken = buildInfraStatus({
  MCP_API_KEY: "short",
  MCP_TEAM_ID: TEAM,
})
assert.equal(broken.connections.find((row) => row.id === "mcp").status, "misconfigured")
assert.equal(JSON.stringify(broken).includes(TEAM), false)

const otherHost = buildInfraStatus({
  NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: ANON,
  SUPABASE_SERVICE_ROLE_KEY: SERVICE,
})
const otherJson = JSON.stringify(otherHost)
assert.equal(otherJson.includes("abcdefghijklmnopqrst"), false)
assert.equal(otherJson.includes("Proyecto de Supabase"), true)

console.log("infra status ok")

import { createHash, timingSafeEqual } from "node:crypto"

/** Long enough that a short or accidental value cannot be a server key. */
const MIN_KEY_LENGTH = 24

const TEAM_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Env vars that must never be accepted as the MCP credential. Callers
 * authenticate with MCP_API_KEY only; OpenAI and Supabase stay on the server.
 */
const RESERVED_ENV = [
  "OPENAI_API_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "RESEND_API_KEY",
] as const

export interface McpKeyRecord {
  teamId: string
  keyHash: Buffer
}

export type McpConfig =
  | { ok: true; keys: McpKeyRecord[] }
  | { ok: false; reason: "unconfigured" | "misconfigured" }

interface KeyInput {
  token?: unknown
  teamId?: unknown
}

function hashKey(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest()
}

function reservedSecrets(env: NodeJS.ProcessEnv): Set<string> {
  const secrets = new Set<string>()
  for (const name of RESERVED_ENV) {
    const value = env[name]
    if (value) secrets.add(value)
  }
  return secrets
}

/**
 * Reads MCP_API_KEY + MCP_TEAM_ID, and optionally MCP_API_KEYS
 * (a JSON array of { "teamId", "token" }). Any invalid entry fails the
 * whole config so a typo cannot silently drop a team. Tokens are hashed
 * immediately and are not kept.
 */
export function loadMcpKeys(env: NodeJS.ProcessEnv): McpConfig {
  const reserved = reservedSecrets(env)
  const records: McpKeyRecord[] = []
  let misconfigured = false
  let sawEntry = false

  const add = (token: unknown, teamId: unknown) => {
    const tokenMissing = typeof token !== "string" || token.trim() === ""
    const teamMissing = typeof teamId !== "string" || teamId.trim() === ""
    if (tokenMissing && teamMissing) return
    sawEntry = true
    if (
      tokenMissing ||
      teamMissing ||
      typeof token !== "string" ||
      typeof teamId !== "string" ||
      token.length < MIN_KEY_LENGTH ||
      /\s/.test(token) ||
      !TEAM_ID.test(teamId) ||
      reserved.has(token)
    ) {
      misconfigured = true
      return
    }
    records.push({
      teamId: teamId.toLowerCase(),
      keyHash: hashKey(token),
    })
  }

  if (env.MCP_API_KEY?.trim() || env.MCP_TEAM_ID?.trim()) {
    add(env.MCP_API_KEY, env.MCP_TEAM_ID)
  }

  const extra = env.MCP_API_KEYS?.trim()
  if (extra) {
    sawEntry = true
    let parsed: unknown
    try {
      parsed = JSON.parse(extra)
    } catch {
      misconfigured = true
      parsed = null
    }
    if (Array.isArray(parsed)) {
      if (parsed.length === 0) misconfigured = true
      for (const entry of parsed) {
        if (!entry || typeof entry !== "object") {
          misconfigured = true
          continue
        }
        const row = entry as KeyInput
        add(row.token, row.teamId)
      }
    } else if (parsed !== null) {
      misconfigured = true
    }
  }

  if (misconfigured || (sawEntry && records.length === 0)) {
    return { ok: false, reason: "misconfigured" }
  }
  if (records.length === 0) return { ok: false, reason: "unconfigured" }
  return { ok: true, keys: records }
}

/** Bearer token only. Empty, basic, or raw tokens are rejected. */
export function bearerToken(header: string | null): string | null {
  if (!header) return null
  const match = /^Bearer\s+(\S+)$/.exec(header.trim())
  if (!match) return null
  if (/\s/.test(match[1])) return null
  return match[1]
}

/**
 * Compares the presented token to every configured key in constant time
 * relative to each key. Returns the matching team, or null.
 */
export function matchMcpKey(
  token: string,
  keys: readonly McpKeyRecord[]
): McpKeyRecord | null {
  const presented = hashKey(token)
  let found: McpKeyRecord | null = null
  for (const key of keys) {
    if (
      presented.length === key.keyHash.length &&
      timingSafeEqual(presented, key.keyHash)
    ) {
      found = key
    }
  }
  return found
}

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"

import { bearerToken, loadMcpKeys, matchMcpKey } from "@/lib/mcp/auth"
import { createLibraryServer } from "@/lib/mcp/server"

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Session-Id, MCP-Protocol-Version",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Max-Age": "86400",
}

function withCors(response: Response): Response {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS)) headers.set(key, value)
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function jsonRpc(status: number, code: number, message: string): Response {
  return withCors(
    Response.json(
      { jsonrpc: "2.0", error: { code, message }, id: null },
      { status }
    )
  )
}

/**
 * Streamable HTTP MCP endpoint. Stateless: each request builds a server
 * scoped to the team of the presented API key. The OpenAI key and the
 * Supabase service role never leave the server.
 */
export async function handleMcp(request: Request): Promise<Response> {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS })
  }
  if (request.method !== "POST" && request.method !== "GET" && request.method !== "DELETE") {
    return jsonRpc(405, -32000, "Method not allowed")
  }

  const config = loadMcpKeys(process.env)
  if (!config.ok) {
    console.error("[mcp] API key configuration is invalid")
    return jsonRpc(503, -32000, "MCP is not configured")
  }

  const token = bearerToken(request.headers.get("authorization"))
  const principal = token ? matchMcpKey(token, config.keys) : null
  if (!principal) return jsonRpc(401, -32001, "Unauthorized")

  const server = createLibraryServer(principal.teamId)
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  try {
    await server.connect(transport)
    const response = await transport.handleRequest(request)
    return withCors(response)
  } catch (error) {
    console.error("[mcp] request failed")
    if (error instanceof Error) console.error("[mcp]", error.name)
    return jsonRpc(500, -32603, "Internal server error")
  } finally {
    await transport.close().catch(() => undefined)
    await server.close().catch(() => undefined)
  }
}

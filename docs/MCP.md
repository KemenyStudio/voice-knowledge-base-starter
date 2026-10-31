# MCP server

Other agents can read one team's library through a remote MCP server at `POST /api/mcp`. The server uses the same OpenAI vector store as chat. Callers send a server API key. The OpenAI key and the Supabase service role stay on this app and are never returned.

## Tools

| Name | What it does |
|---|---|
| `list_assistants` | Assistants in the key's team, with a document count. |
| `search_library` | Passages from that assistant's vector store (the same search the chat uses). |
| `list_documents` | Library rows: name, tags, audience, outdated flag. |
| `get_document` | One library row by id. |
| `get_feedback_summary` | This team's evaluation votes and answer ratings (thumbs up/down, triage). |

Tool descriptions are in Spanish. Every tool is read-only. A tool argument cannot choose the team: the API key is bound to one team, and a document or assistant from another team comes back as not found.

`search_library` does not write an answer. It returns up to 12 documents with short passages. Optional `entityType` (for example `Sofipos`) applies the same audience filter as chat. Without it, the search covers the whole store. There is a limit of 30 searches per minute per team.

`get_feedback_summary` counts votes whose `chatbot_id` belongs to the team, and the same answer-rating totals the admin overview uses (positive, low, open, resolved, stored answers, answers with no sources). It does not return the global `feedback_summary` row, user ids, e-mails, comments, or answer text. When an evaluation run is stored, only the numeric `summary` (totals and scores) is included.

## Server configuration

Set these on the server (Vercel env for production, `.env.local` for local). Do not put the OpenAI key or the service role in either variable.

```bash
MCP_API_KEY=a long random token
MCP_TEAM_ID=the team uuid
```

The token must be at least 24 characters and must not match `OPENAI_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, the anon key, or `RESEND_API_KEY`. If it does, the endpoint stays unconfigured (HTTP 503) instead of accepting that secret as a login.

More than one team: `MCP_API_KEYS` is a JSON array. Each entry is one team. If you set this, you can leave the single-key pair empty.

```json
[
  { "teamId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "token": "first long random token" },
  { "teamId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "token": "second long random token" }
]
```

Generate a token locally and store it in the host's secret manager. Example:

```bash
openssl rand -base64 32
```

The app reads the variables on each request. After changing them in Vercel, production picks them up on the next deploy from `main` (or a redeploy of the current production deployment).

Until the variables are set, `POST /api/mcp` returns 503 `MCP is not configured`. A missing or wrong token returns 401 `Unauthorized`. A session cookie does not authenticate this route.

## Connect an agent

The endpoint speaks [MCP Streamable HTTP](https://modelcontextprotocol.io/specification/2025-03-26/basic/transports). Responses are JSON (`enableJsonResponse`). Send:

- `Authorization: Bearer <MCP_API_KEY>`
- `Accept: application/json, text/event-stream`
- `Content-Type: application/json` on `POST`

Replace `https://your-app.example.com` with the deployed origin.

### Cursor

Add this to the MCP config (Cursor Settings → MCP, or `~/.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "ai-search": {
      "url": "https://your-app.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>"
      }
    }
  }
}
```

### Claude Desktop / any client that accepts a remote URL

```json
{
  "mcpServers": {
    "ai-search": {
      "type": "http",
      "url": "https://your-app.example.com/api/mcp",
      "headers": {
        "Authorization": "Bearer <MCP_API_KEY>"
      }
    }
  }
}
```

### A direct HTTP call

```bash
curl -s https://your-app.example.com/api/mcp \
  -H "Authorization: Bearer $MCP_API_KEY" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Search:

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "search_library",
    "arguments": { "query": "¿De qué tratan los documentos de esta biblioteca?" }
  }
}
```

The Postman collection has the same requests under **MCP**. The collection variable is `mcpApiKey`. Put the token only in your local Postman environment, not in the collection file.

## What the client never receives

Document payloads omit storage paths, OpenAI file ids, and vector store ids. Errors are generic. The server uses `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` only inside the route, after the API key has been checked.

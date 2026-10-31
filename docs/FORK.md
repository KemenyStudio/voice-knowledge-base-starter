# Fork this app

Use this for any set of documents. Each team sets its own assistant name, example questions and, if it wants them, audience profiles.

## 1. Clone and install

Requirements: Node 20+, pnpm, a Supabase project, an OpenAI API key, and a Resend key if you send team invitations.

```bash
git clone https://github.com/KemenyStudio/voice-knowledge-base-starter.git
cd voice-knowledge-base-starter
pnpm install
cp .env.example .env.local
```

Fill `.env.local` from the names in `.env.example`. Do not commit that file.

| Variable | What to put |
|---|---|
| `NEXT_PUBLIC_APP_NAME` | Name on the landing page and the browser tab |
| `NEXT_PUBLIC_APP_URL` | Public URL of this deployment (used in invitation links) |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (server only) |
| `SUPABASE_STORAGE_BUCKET` | `knowledge`, unless you change the migration |
| `OPENAI_API_KEY` | Key with access to the model ids below |
| `OPENAI_MODEL_ANSWER` | Model used to answer |
| `RESEND_API_KEY` | Only if you email invitations |
| `MCP_API_KEY` | Optional. Token other agents send to `POST /api/mcp`. Not the OpenAI key. See [MCP.md](MCP.md) |
| `MCP_TEAM_ID` | Team uuid that `MCP_API_KEY` can read |

## 2. Database

Apply every file in `supabase/migrations/` in filename order, on an empty project or on top of a database that already ran the earlier files. The latest file fills example questions and a welcome sentence only where those fields are still empty. It does not replace a system prompt or an audience list that is already stored.

The migrations create the private `knowledge` storage bucket.

## 3. Run it

```bash
pnpm dev
```

Open the app, create an account in Supabase Auth (or the register screen if you enable it), sign in, and open **Inicio**.

## 4. First team and assistant

1. On **Inicio**, create a team. You become its admin.
2. Open the team and create an assistant. Give it a name and a short description of the documents it will answer from.
3. Open the assistant, go to **Biblioteca**, and upload the documents. Indexing starts on upload. Members can chat once at least one document is ready.
4. Open **Asistente**. Set the name if you want to change it, the welcome text, and the example questions (one question per line, a line starting with `##` starts a category). Save.

A new assistant starts with three generic example questions and a welcome that uses its name. Replace them with questions your documents can answer. Leave the system prompt empty to use the built-in instructions: answer only from the uploaded documents and cite them. Put your own instructions in the system prompt only when you need them.

## 5. Optional: profiles

If different documents apply to different groups of people, list those groups under **Perfiles de audiencia** (one per line, at most 8) and tag documents in the library. The search filter stays off until you turn on **Buscar solo en documentos aplicables**. Leave the list empty when every document applies to everyone.

`chatbots.audience_aliases` is an optional JSON object for a tag that should expand to several profiles, for example `{"socios":["Socio oro","Socio plata"]}`. It is empty unless you set it.

## What stays in your database

Assistant name, welcome, example questions, system prompt and audience profiles are rows in `chatbots`, not constants in the app. Editing them does not require a code change.

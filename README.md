# Document Search

A starting point for a product that searches a private document library and answers with cited passages.

People sign in, an admin uploads documents, and members ask questions. Answers use only that assistant's library and point back to the passages they came from. The app also has feedback, a usage page, an infrastructure page, a voice-call hook, an MCP route for other agents, a dark and light theme, and a sidebar that can be hidden.

It is a Next.js 14 app. Supabase holds accounts, teams, chat history, and the original files. OpenAI answers through the Responses API with `file_search` and a vector store per assistant. Resend sends invitation and alert email when you connect it. Vercel is the intended host.

## What you need

- Node.js 20 or newer and pnpm
- A Supabase project (auth, database, and storage)
- An OpenAI API key that can use the model ids in `.env.example`
- A Resend API key and a verified sender address, if you send invitations or alerts
- A Vercel project, when you deploy

Copy `.env.example` to `.env.local` and fill the empty values. Do not commit `.env.local`.

| Variable | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_NAME` | Name on the landing page and the browser tab. Default: Document Search |
| `NEXT_PUBLIC_APP_URL` | Public URL used in invitation links |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only Supabase key |
| `OPENAI_API_KEY` | Answers, indexing, metadata, and voice |
| `RESEND_API_KEY` | Invitations and alerts. Leave empty to skip email |
| `EMAIL_FROM` | Sender on your Resend domain |
| `MCP_API_KEY` and `MCP_TEAM_ID` | Optional. Lets another agent call `POST /api/mcp` for one team |

## Run it locally

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Apply the SQL files in `supabase/migrations/` in filename order on an empty Supabase project. They create the tables, row-level security, and the private `knowledge` storage bucket. More detail is in [docs/FORK.md](docs/FORK.md).

Then create an account, sign in, create a team, create an assistant, and upload documents from the library. A new assistant starts with a short placeholder prompt: search the private library and cite passages. Replace that prompt, the welcome text, and the example questions in the assistant settings when you have your own documents.

## What was removed

This repository is a fresh history. It is not a copy of a private deployment.

Removed before publication:

- API keys, tokens, service-role key values, and environment files with real values
- Customer documents, compiled corpora, evaluation sets, and real questions
- Vector-store ids, team ids, agent ids, and the customer's Supabase project reference
- System prompts and assistant instructions written for one bank and its regulations
- Customer names and branding in the app, production URLs, and internal rollout notes

The default prompt is a generic placeholder. Connect your own OpenAI, Supabase, Vercel, and Resend projects. An optional source watcher still knows how to read a few Mexican official pages (the official gazette, CNBV, and Banxico). It does not include any documents from those sites.

## Layout

```
app/            Next.js routes, including chat, library, feedback, usage, and infrastructure
components/     UI, theme, and the hideable sidebar
lib/            Auth, retrieval, voice session hooks, and the MCP handler
supabase/migrations/  SQL, applied in filename order
postman/        API collection
ios/            Optional SwiftUI client
docs/           Setup notes for MCP, voice harness, and admin tools
```

Browser routes need a signed-in Supabase session. `POST /api/mcp` is the exception: other agents send a server API key scoped to one team. See [docs/MCP.md](docs/MCP.md).

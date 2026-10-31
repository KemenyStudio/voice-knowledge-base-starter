# Onboarding, document actions, feedback triage and library health

Admin tools for a team library. Migration: `supabase/migrations/20261005150000_admin_tools.sql` (additive).

## Document actions (everyone)

Every source under an answer has a "..." menu:

| Action | Documents | What the assistant does |
|---|---|---|
| Resumir este documento | 1 | Structured summary: what it is, content by section, deadlines, validity. |
| Comparar con otro documento | 2 | Table by topic (scope, obligations, deadlines, sanctions) plus key differences. |
| Ver qué cambió | 2 | "Before / now" table and what stays the same; says when the comparison is partial. |

How it works: the client sends `focus: { action, fileIds }` to `POST /api/chat`. The search is limited to those Library documents with a `file_row_id` attribute filter, retrieval is raised to 30 passages, the entity filter and clarifying questions are skipped, and the model gets a task prompt. The ids must belong to the assistant (404 otherwise); a summary takes one id, the other two actions take two.

Limits: the comparison is based on the retrieved passages, not the full text; the answer says so. Files that only exist in the search index (see library health) have no Library id and offer no actions.

## Outdated documents (admins flag, everyone sees)

`PATCH /api/files/:id` with `{ outdated, note }`. The Biblioteca shows a badge and a flag button; answers that cite the document show "Desactualizado" next to the source, and the warning is stored with the message. The document is never hidden or removed automatically.

## Prompt notes (admins)

Up to 10 team instructions of 300 characters in "Asistente" (`chatbots.prompt_notes`). They are appended to the assistant's instructions under "Indicaciones del equipo". Notes can also come from feedback triage.

## Feedback triage (admins)

"Retroalimentación" lists ratings with the question, answer, comment and the cited documents; filters for rating and status; grouping by document. Per item:

- **Marcar documento desactualizado**: pick one of the cited documents.
- **Agregar nota al asistente**: appends to the prompt notes (max 10).
- **Pedir documento**: records what is missing; stays open until resolved.
- **Descartar / Marcar como resuelta / Reabrir**.

Safe default: nothing is emailed. The dialog has an unchecked option to send the person who rated a short resolution notice (Resend template `feedback-resolved`).

## Library health (admins)

Panel at the top of the Biblioteca (`GET /api/files/health?chatbotId=`):

- No file, not indexed, failed (with a plain-language reason), stuck indexing, no tags, outdated.
- Files that exist only in the search index. They can be removed from the index (`POST /api/files/health`, `remove_orphans`) after confirmation. Only ids reported as index-only are removed, and removal is refused while a recent upload has not finished registering. The Library itself is never touched.

## Guided onboarding

Team admins see a "Primeros pasos" checklist on the team page (assistant, documents, teammate, first question) computed by `GET /api/teams/:id/onboarding`; it disappears when complete or when hidden. The empty chat shows a one-line summary of the knowledge base (documents, main types, last update) from `GET /api/chatbots/:id` (`knowledge`).

## Tests

- `scripts/e2e-admin-tools-smoke.mjs <chatbotId> [baseUrl]` (36 checks; reverts every change it makes and deletes its temporary users).
- `scripts/test-health.mjs` (pure health report logic).
- `scripts/e2e-browser-check.mjs` covers the UI (48 checks).

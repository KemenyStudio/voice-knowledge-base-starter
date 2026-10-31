# Entity-type memory, audience and clarifying questions

How audience profiles and clarifying questions work.

## What users see

- **First visit**: the empty chat asks "¿Para qué tipo de entidad trabajas?" with one button per entity type. "Ahora no" hides it.
- **Header chip**: shows the remembered entity type; click to change it or forget it.
- **Answers adapt**: the model receives "El usuario opera una entidad de tipo X".
- **Clarifying questions**: if a question is really ambiguous the assistant asks one short question with buttons instead of answering. Clicking a button sends it as the next message. When the missing data is the entity type, the choice is also saved.
- **Filter note** (only when the filter is on): "Se buscó en los documentos aplicables a X. Buscar en todos los documentos" repeats the question over everything.

## What admins configure

1. **Asistente > Tipos de entidad**: up to 8, one per line. Saving rewrites the search index attributes.
2. **Biblioteca > Audiencia de los documentos**:
   - *Importar de las etiquetas*: classifies documents whose tags all map to an audience profile (a short tag can map to several profiles when an alias says so). Documents with a tag that does not map are left for review, because narrowing them could hide them from someone they apply to.
   - *Sugerir con IA*: reads the scope passages of each unclassified document and proposes the entity types. Suggestions are shown as "Sugerido" and change nothing until accepted.
   - *Aceptar sugerencias*: confirms them.
   - The users icon on each row edits one document by hand (nothing checked = applies to all).
3. **Asistente > Buscar solo en documentos aplicables**: turns the filter on. Off by default.

## Safety defaults

- The filter is **off** until an admin turns it on.
- A document that is unclassified, or classified as "all", is **never hidden**.
- AI output is only a suggestion. Nothing is applied without an admin accepting it.
- If the filter would leave fewer than 3 documents, it is skipped for that question.
- Users can always repeat a question over all documents.
- At most one clarifying question in a row, and none when the information is already known.

## How the filter works

The vector store only supports attribute filters that exclude well: `ne` keeps documents that lack the attribute, while `or(eq ...)` hides them. So each document carries `excl_<entity> = true` for every entity type it does **not** apply to, and the search filter is `excl_<user entity> != true`. Documents without markers always match. OpenAI allows 16 attributes per file: 6 base plus at most 8 markers.

## Operations

- Backfill from tags: `node --env-file=.env scripts/backfill-audience.mjs <chatbotId> [--dry-run]`.
- Tests: `node scripts/test-audience.mjs`, `node scripts/test-clarify.mjs`, `node --env-file=.env scripts/e2e-entity-smoke.mjs <chatbotId> [baseUrl]`, and the browser check.
- To undo everything: leave `audience_filter` off. Audience columns and markers have no effect on search without it.

## Known limits

- Files that exist in the vector store but not in the Library (legacy duplicates) have no markers and are always searched.
- Entity tags are coarse (for example "Bancos" for every bank regulation); review the audience of documents that matter before turning the filter on.

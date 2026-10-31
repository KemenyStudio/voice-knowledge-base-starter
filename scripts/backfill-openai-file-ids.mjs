#!/usr/bin/env node
/**
 * Links legacy documents (sync_status = 'external') to the OpenAI files that
 * already live in their vector store, so the app can edit and delete them.
 *
 *   node --env-file=.env scripts/backfill-openai-file-ids.mjs <chatbotId> [--dry-run]
 *       [--pair-duplicates] [--stamp-attributes]
 *
 * Matching, in order:
 *   1. the OpenAI filename equals the row's file_name or the last segment of its
 *      file_url (case and accents ignored);
 *   2. the OpenAI file has exactly the same byte size as the stored original
 *      (`files.size_bytes`). If several files share a size, the row is paired
 *      only when one candidate's name is clearly the most similar.
 * Rows with no or ambiguous matches are reported and left untouched, unless:
 *   --pair-duplicates   pairs the leftovers that share a byte size (same size
 *                       means the same content, so which row gets which copy
 *                       does not change what the assistant can retrieve);
 *   --stamp-attributes  writes row id, chatbot id, file name and tags onto the
 *                       vector store file of every linked row, so search
 *                       results (citations) can be traced back to the library.
 *
 * Needs OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import OpenAI from "openai"
import { createClient } from "@supabase/supabase-js"

const [chatbotId, ...flags] = process.argv.slice(2)
const dryRun = flags.includes("--dry-run")
const pairDuplicates = flags.includes("--pair-duplicates")
const stampAttributes = flags.includes("--stamp-attributes")

if (!chatbotId) {
  console.error("Usage: backfill-openai-file-ids.mjs <chatbotId> [--dry-run]")
  process.exit(1)
}
for (const name of ["OPENAI_API_KEY", "NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[name]) {
    console.error(`Missing ${name}`)
    process.exit(1)
  }
}

const openai = new OpenAI()
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const normalize = (value) =>
  decodeURIComponent(String(value ?? ""))
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase()

const lastSegment = (url) => {
  try {
    return decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "")
  } catch {
    return String(url ?? "").split("/").pop() ?? ""
  }
}

const { data: chatbot, error: chatbotError } = await supabase
  .from("chatbots")
  .select("id, name, vector_store_id")
  .eq("id", chatbotId)
  .single()
if (chatbotError || !chatbot) {
  console.error("Chatbot not found:", chatbotError?.message)
  process.exit(1)
}
if (!chatbot.vector_store_id) {
  console.error(`Chatbot "${chatbot.name}" has no vector_store_id yet.`)
  process.exit(1)
}
console.log(`Chatbot: ${chatbot.name}  Vector store: ${chatbot.vector_store_id}${dryRun ? "  (dry run)" : ""}`)

// 1. Everything in the vector store, with its filename.
const remote = []
for await (const vsFile of openai.vectorStores.files.list(chatbot.vector_store_id, { limit: 100 })) {
  const file = await openai.files.retrieve(vsFile.id)
  remote.push({ id: vsFile.id, name: file.filename, bytes: file.bytes, status: vsFile.status })
}
console.log(`OpenAI files in store: ${remote.length}`)

const remoteByName = new Map()
for (const file of remote) {
  const key = normalize(file.name)
  remoteByName.set(key, [...(remoteByName.get(key) ?? []), file])
}

// 2. Legacy rows to link.
const { data: rows, error: rowsError } = await supabase
  .from("files")
  .select("id, file_name, file_url, size_bytes")
  .eq("chatbot_id", chatbotId)
  .is("openai_file_id", null)
if (rowsError) {
  console.error(rowsError.message)
  process.exit(1)
}
console.log(`Rows to link: ${rows.length}`)

// Files already linked by an earlier run must not be matched again.
const { data: alreadyLinked } = await supabase
  .from("files")
  .select("openai_file_id")
  .eq("chatbot_id", chatbotId)
  .not("openai_file_id", "is", null)
const used = new Set((alreadyLinked ?? []).map((r) => r.openai_file_id))
let linked = 0
const unmatched = []
const ambiguous = []

const tokens = (value) =>
  new Set(
    normalize(String(value).replace(/\.[a-z0-9]{2,5}$/i, ""))
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((t) => t.length > 2)
  )
const similarity = (a, b) => {
  const ta = tokens(a)
  const tb = tokens(b)
  if (!ta.size || !tb.size) return 0
  let shared = 0
  for (const t of ta) if (tb.has(t)) shared += 1
  return shared / (ta.size + tb.size - shared)
}

async function link(row, match) {
  used.add(match.id)
  if (!dryRun) {
    const { error } = await supabase
      .from("files")
      .update({
        openai_file_id: match.id,
        vector_store_id: chatbot.vector_store_id,
        sync_status: match.status === "completed" ? "ready" : "processing",
      })
      .eq("id", row.id)
    if (error) {
      console.error(`Update failed for ${row.file_name}: ${error.message}`)
      used.delete(match.id)
      return
    }
  }
  linked += 1
}

// Pass 1: by name.
const pending = []
for (const row of rows) {
  const byName = [
    ...(remoteByName.get(normalize(row.file_name)) ?? []),
    ...(remoteByName.get(normalize(lastSegment(row.file_url))) ?? []),
  ]
    .filter((file, index, all) => all.findIndex((other) => other.id === file.id) === index)
    .filter((file) => !used.has(file.id))
  if (byName.length === 1) await link(row, byName[0])
  else pending.push(row)
}

// Pass 2: by exact byte size.
for (const row of pending) {
  const candidates = remote.filter((file) => !used.has(file.id) && row.size_bytes && file.bytes === row.size_bytes)
  if (candidates.length === 0) {
    unmatched.push(row.file_name)
    continue
  }
  const rowsSameSize = pending.filter((other) => other.size_bytes === row.size_bytes).length
  if (candidates.length === 1 && rowsSameSize === 1) {
    await link(row, candidates[0])
    continue
  }
  // Several candidates or several rows with this size: pair only on a clear name winner.
  const ranked = candidates
    .map((file) => ({ file, score: similarity(row.file_name, file.name) }))
    .sort((a, b) => b.score - a.score)
  if (ranked[0].score >= 0.5 && (ranked.length === 1 || ranked[0].score - ranked[1].score >= 0.2)) {
    await link(row, ranked[0].file)
  } else if (pairDuplicates) {
    await link(row, ranked[0].file)
  } else {
    ambiguous.push(`${row.file_name} -> ${candidates.map((c) => c.name).join(" | ")}`)
  }
}

const orphans = remote.filter((file) => !used.has(file.id))
console.log(`\nLinked: ${linked}`)
console.log(`Unmatched rows (${unmatched.length}):`, unmatched.slice(0, 20))
console.log(`Ambiguous rows (${ambiguous.length}):`, ambiguous.slice(0, 20))
console.log(`OpenAI files without a row (${orphans.length}):`, orphans.slice(0, 20).map((f) => f.name))

// Optional: stamp searchable attributes on every linked vector store file.
if (stampAttributes) {
  const { data: linkedRows, error } = await supabase
    .from("files")
    .select("id, file_name, metadata, openai_file_id")
    .eq("chatbot_id", chatbotId)
    .not("openai_file_id", "is", null)
  if (error) throw error
  const clip = (value) => String(value).slice(0, 512)
  let stamped = 0
  let failed = 0
  for (const row of linkedRows) {
    const meta = row.metadata ?? {}
    const attributes = {
      file_row_id: row.id,
      chatbot_id: chatbotId,
      file_name: clip(row.file_name),
    }
    if (meta.type_tag) attributes.type_tag = clip(meta.type_tag)
    if (meta.target_tag?.length) attributes.target_tag = clip(meta.target_tag.join(", "))
    if (meta.entity_tag?.length) attributes.entity_tag = clip(meta.entity_tag.join(", "))
    if (dryRun) {
      stamped += 1
      continue
    }
    try {
      await openai.vectorStores.files.update(row.openai_file_id, {
        vector_store_id: chatbot.vector_store_id,
        attributes,
      })
      stamped += 1
    } catch (err) {
      failed += 1
      console.error(`Could not stamp ${row.file_name}: ${err.message}`)
    }
  }
  console.log(`Attributes stamped: ${stamped}${failed ? `  failed: ${failed}` : ""}`)
}

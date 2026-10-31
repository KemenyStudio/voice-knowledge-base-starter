#!/usr/bin/env node
/**
 * Copies legacy documents from their old Azure Blob URL into the private
 * Supabase Storage bucket, then points the `files` row at the copy.
 *
 *   node --env-file=.env.local scripts/migrate-blobs-to-supabase.mjs [--dry-run] [--chatbot <id>]
 *
 * Only rows without `blob_name` are touched, so it is safe to re-run.
 * The old container must still be publicly readable (it was, by design of the
 * previous version) or the downloads will fail and be reported. Do NOT make the
 * Azure container private or delete it until this has run.
 *
 * Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 */
import { randomUUID } from "node:crypto"
import { createClient } from "@supabase/supabase-js"

const args = process.argv.slice(2)
const dryRun = args.includes("--dry-run")
const chatbotFlag = args.indexOf("--chatbot")
const onlyChatbot = chatbotFlag === -1 ? null : args[chatbotFlag + 1]

for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) {
  if (!process.env[name]) {
    console.error(`Missing ${name}`)
    process.exit(1)
  }
}
const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "knowledge"
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const CONTENT_TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  md: "text/markdown",
  html: "text/html",
  json: "application/json",
}

// Same rules as buildStoragePath() in lib/storage.ts.
function buildStoragePath(teamId, chatbotId, fileName) {
  const dot = fileName.lastIndexOf(".")
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot + 1) : ""
  const clean = (value) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
  const safeStem = clean(stem).slice(0, 80) || "document"
  const safeExt = clean(ext).slice(0, 10)
  return `${teamId}/${chatbotId}/${randomUUID()}-${safeStem}${safeExt ? `.${safeExt}` : ""}`
}

// The old app stored URLs without encoding the file name.
function encodeUrl(raw) {
  try {
    const url = new URL(raw)
    return url.origin + url.pathname.split("/").map((s) => encodeURIComponent(decodeURIComponentSafe(s))).join("/")
  } catch {
    return null
  }
}
function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

let query = supabase
  .from("files")
  .select("id, file_name, file_url, file_type, chatbot_id, chatbots!inner(team_id)")
  .is("blob_name", null)
if (onlyChatbot) query = query.eq("chatbot_id", onlyChatbot)
const { data: rows, error } = await query
if (error) {
  console.error(error.message)
  process.exit(1)
}
console.log(`Files to copy: ${rows.length}${dryRun ? "  (dry run)" : ""}`)

let copied = 0
const failed = []

async function migrate(row) {
  const url = encodeUrl(row.file_url)
  if (!url || !/^https?:/i.test(url)) throw new Error(`no usable file_url (${row.file_url})`)

  const response = await fetch(url)
  if (!response.ok) throw new Error(`download failed: HTTP ${response.status}`)
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error("downloaded file is empty")
  if (dryRun) return

  const team = Array.isArray(row.chatbots) ? row.chatbots[0] : row.chatbots
  const ext = (row.file_type || row.file_name.split(".").pop() || "").toLowerCase()
  const path = buildStoragePath(team.team_id, row.chatbot_id, row.file_name)

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: CONTENT_TYPES[ext] || response.headers.get("content-type") || undefined,
    upsert: false,
  })
  if (uploadError) throw new Error(`upload failed: ${uploadError.message}`)

  const { error: updateError } = await supabase
    .from("files")
    .update({
      blob_name: path,
      file_url: `/api/files/${row.id}/download`,
      size_bytes: buffer.length,
    })
    .eq("id", row.id)
  if (updateError) {
    await supabase.storage.from(BUCKET).remove([path])
    throw new Error(`row update failed: ${updateError.message}`)
  }
}

// A few at a time: gentle on the old storage account and on the API.
const queue = [...rows]
await Promise.all(
  Array.from({ length: 4 }, async () => {
    while (queue.length) {
      const row = queue.shift()
      try {
        await migrate(row)
        copied += 1
        if (copied % 20 === 0) console.log(`  ${copied} done`)
      } catch (err) {
        failed.push(`${row.file_name}: ${err.message}`)
      }
    }
  })
)

console.log(`\nCopied: ${copied}`)
console.log(`Failed: ${failed.length}`)
for (const line of failed.slice(0, 30)) console.log("  -", line)
process.exit(failed.length ? 2 : 0)

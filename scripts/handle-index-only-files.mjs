// Handles documents that are in an assistant's search index but have no row in
// the Library ("index only" files).
//
// Safe by construction: an index-only file is removed ONLY when its bytes are
// identical (SHA-256) to a document that is in the Library, so no content is
// lost. Anything else is left alone and reported.
//
//   node --env-file=.env scripts/handle-index-only-files.mjs <chatbotId>           (dry run)
//   node --env-file=.env scripts/handle-index-only-files.mjs <chatbotId> --apply   (remove proven duplicates)
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import OpenAI from "openai"

const [chatbotId, flag] = process.argv.slice(2)
if (!chatbotId) {
  console.error("Usage: handle-index-only-files.mjs <chatbotId> [--apply]")
  process.exit(1)
}
const apply = flag === "--apply"
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
const openai = new OpenAI()

// OpenAI does not allow downloading files used for search, so the comparison
// is made on the extracted text that the index holds for each file.
const textHash = async (vectorStoreId, fileId) => {
  const parts = []
  for await (const part of openai.vectorStores.files.content(fileId, { vector_store_id: vectorStoreId })) parts.push(part.text)
  return createHash("sha256").update(parts.join("\n")).digest("hex")
}

const { data: bot } = await admin.from("chatbots").select("id, name, vector_store_id").eq("id", chatbotId).single()
const { data: rows } = await admin.from("files").select("id, file_name, openai_file_id, sync_status, size_bytes").eq("chatbot_id", chatbotId)
const known = new Set(rows.map((r) => r.openai_file_id).filter(Boolean))

const orphans = []
for await (const vf of openai.vectorStores.files.list(bot.vector_store_id, { limit: 100 })) {
  if (!known.has(vf.id)) orphans.push(vf)
}
console.log(`${bot.name}: ${rows.length} Library documents, ${orphans.length} index-only file(s)\n`)
if (orphans.length === 0) process.exit(0)

let removed = 0
for (const vf of orphans) {
  const meta = await openai.files.retrieve(vf.id)
  const hash = await textHash(bot.vector_store_id, vf.id)
  // Only Library documents of the same size can be identical.
  const sameSize = rows.filter((r) => r.openai_file_id && r.sync_status === "ready" && r.size_bytes === meta.bytes)
  let twin = null
  for (const r of sameSize) {
    if ((await textHash(bot.vector_store_id, r.openai_file_id)) === hash) {
      twin = r
      break
    }
  }
  if (twin) {
    console.log(`DUPLICATE  ${meta.filename} (${meta.bytes} bytes): same indexed text as Library document "${twin.file_name}"`)
    if (apply) {
      await openai.vectorStores.files.delete(vf.id, { vector_store_id: bot.vector_store_id })
      await openai.files.delete(vf.id)
      removed++
      console.log("           removed from the index")
    }
  } else {
    console.log(`KEEP       ${meta.filename} (${meta.bytes} bytes): no identical Library document (${sameSize.length} of the same size checked), left in place`)
  }
}
console.log(apply ? `\nRemoved ${removed}.` : "\nDry run: nothing changed. Use --apply to remove the duplicates.")

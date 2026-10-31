import { getOpenAI } from "@/lib/openai"
import { extractDocumentExcerpt } from "@/lib/knowledge/extract-text"
import { downloadObject } from "@/lib/storage"
import type { FileRow } from "@/types/knowledge"

const MIN_TEXT = 40

async function indexedExcerpt(vectorStoreId: string, fileRowId: string): Promise<string> {
  const found = await getOpenAI().vectorStores.search(vectorStoreId, {
    query:
      "de qué trata este documento, a quién aplica, quién lo emite y cuál es su ámbito",
    filters: { type: "eq", key: "file_row_id", value: fileRowId },
    max_num_results: 8,
  })
  return found.data
    .flatMap((hit) => hit.content.map((part) => part.text))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12_000)
}

/**
 * Reads text already in the library. Uses the stored file when it exists,
 * and the indexed passages otherwise. Does not upload or delete anything.
 */
export async function readStoredDocumentText(file: FileRow): Promise<string> {
  if (file.blob_name) {
    try {
      const buffer = await downloadObject(file.blob_name)
      const extracted = await extractDocumentExcerpt(
        file.file_name,
        buffer,
        file.file_type
      )
      if (extracted.trim().length >= MIN_TEXT) return extracted
    } catch (error) {
      console.error("[readStoredDocumentText]", file.id, error)
    }
  }
  if (file.vector_store_id && file.sync_status !== "failed") {
    try {
      return await indexedExcerpt(file.vector_store_id, file.id)
    } catch (error) {
      console.error("[readStoredDocumentText] index", file.id, error)
    }
  }
  return ""
}

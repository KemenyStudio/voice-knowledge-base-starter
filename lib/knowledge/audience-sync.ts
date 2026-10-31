import { buildAttributes, updateVectorFileAttributes } from "@/lib/knowledge/vector-store"
import type { ChatbotRow, FileRow } from "@/types/knowledge"

/** Runs `worker` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index])
    }
  })
  await Promise.all(runners)
  return results
}

export interface AttributeSyncResult {
  updated: number
  failed: string[]
  skipped: number
}

/**
 * Rewrites the vector store attributes of the given documents so they match
 * the database (audience, tags). Documents that are not indexed are skipped.
 */
export async function syncAttributes(
  chatbot: ChatbotRow,
  files: FileRow[]
): Promise<AttributeSyncResult> {
  const indexed = files.filter((f) => f.openai_file_id && f.vector_store_id)
  const failed: string[] = []
  let updated = 0

  await mapLimit(indexed, 6, async (file) => {
    try {
      await updateVectorFileAttributes(
        file.vector_store_id as string,
        file.openai_file_id as string,
        buildAttributes({
          fileRowId: file.id,
          chatbotId: chatbot.id,
          fileName: file.file_name,
          metadata: file.metadata,
          audience: {
            options: chatbot.audience_options ?? [],
            applies: file.audience ?? [],
          },
        })
      )
      updated += 1
    } catch (error) {
      console.error("[syncAttributes]", file.id, error)
      failed.push(file.id)
    }
  })

  return { updated, failed, skipped: files.length - indexed.length }
}

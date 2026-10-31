import { getOpenAI } from "@/lib/openai"
import type { IndexSnapshot } from "@/lib/knowledge/library-summary"

/**
 * Reads the assistant's vector store once. `filesCompleted` is the real count
 * of files that finished indexing. The API does not return a text-chunk total.
 */
export async function readIndexFileCounts(
  vectorStoreId: string
): Promise<IndexSnapshot | null> {
  try {
    const store = await getOpenAI().vectorStores.retrieve(vectorStoreId)
    const counts = store.file_counts
    return {
      filesCompleted: counts.completed,
      filesFailed: counts.failed,
      filesCancelled: counts.cancelled,
      filesInProgress: counts.in_progress,
      filesTotal: counts.total,
      usageBytes: store.usage_bytes,
    }
  } catch (error) {
    console.error("[files/summary] index", error instanceof Error ? error.name : "error")
    return null
  }
}

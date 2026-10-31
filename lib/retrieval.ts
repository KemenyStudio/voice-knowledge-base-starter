import type { FileSearchTool } from "openai/resources/responses/responses"
import type { VectorStoreSearchParams } from "openai/resources/vector-stores/vector-stores"

/**
 * Retrieval settings from the current OpenAI file search and retrieval guides.
 *
 * Chunking is applied only when a file is added. The guides do not require
 * re-chunking files that are already indexed, so the live library is left as
 * it is.
 *
 * https://developers.openai.com/api/docs/guides/tools-file-search
 * https://developers.openai.com/api/docs/guides/retrieval
 */

/** File search example in the current Responses reference. The API allows 1–50. */
export const FILE_SEARCH_MAX_RESULTS = 20
export const FILE_SEARCH_RESULT_CAP = 50
/** Compare / summarize / what-changed: more chunks from the chosen documents. */
export const FOCUS_FILE_SEARCH_MAX_RESULTS = 40

/**
 * `auto` is the ranker the current API accepts (`default-2024-11-15` is the
 * other). `score_threshold` 0 keeps a lower-scored chunk that still contains
 * the cited fact; a higher threshold can drop it.
 * Hybrid search raises textual overlap (amounts, articles, emails) above a
 * merely similar section. Both weights are greater than zero.
 */
export const RETRIEVAL_RANKING = {
  ranker: "auto" as const,
  score_threshold: 0,
  hybrid_search: {
    embedding_weight: 0.5,
    text_weight: 1,
  },
}

/**
 * Used the next time a file is attached. Limits from the retrieval guide:
 * chunk size 100–4096, overlap at most half the chunk size.
 * 1600 / 400 keeps a legal article together more often than the 800-token
 * default. It does not change files already in the store.
 */
export const CHUNKING_STRATEGY = {
  type: "static" as const,
  static: {
    max_chunk_size_tokens: 1600,
    chunk_overlap_tokens: 400,
  },
}

/** How much of the retrieved chunks is stored with the citation. */
export const CITATION_TEXT_MAX = 24000

export const LIBRARY_GROUNDING = `

# Precisión de la biblioteca

- Cada cifra, plazo, correo, artículo o límite que afirmes tiene que aparecer en un pasaje recuperado. Si el pasaje no lo contiene, di que no aparece.
- No completes la respuesta con conocimiento externo. Esta respuesta no usa la web.`

export function fileSearchTool(input: {
  vectorStoreId: string
  maxNumResults?: number
  filters?: FileSearchTool["filters"]
}): FileSearchTool {
  const requested = input.maxNumResults ?? FILE_SEARCH_MAX_RESULTS
  return {
    type: "file_search",
    vector_store_ids: [input.vectorStoreId],
    max_num_results: Math.min(Math.max(requested, 1), FILE_SEARCH_RESULT_CAP),
    ranking_options: RETRIEVAL_RANKING,
    ...(input.filters ? { filters: input.filters } : {}),
  }
}

/** Same ranking for a direct vector-store search (research and classification). */
export function vectorSearchRanking(): VectorStoreSearchParams["ranking_options"] {
  return RETRIEVAL_RANKING
}

export interface ScoredPassage {
  text: string
  score: number
}

/**
 * Every retrieved chunk of a document, highest score first, so the stored
 * citation contains the fact even when it was not the single top chunk.
 */
export function joinPassages(
  passages: ScoredPassage[],
  maxChars = CITATION_TEXT_MAX
): string {
  const seen = new Set<string>()
  const parts: string[] = []
  let used = 0
  const ordered = [...passages].sort((a, b) => b.score - a.score)
  for (const passage of ordered) {
    const text = passage.text.trim()
    if (!text || seen.has(text)) continue
    seen.add(text)
    const separator = parts.length > 0 ? 2 : 0
    if (used + separator + text.length > maxChars) {
      const room = maxChars - used - separator
      if (room > 200) parts.push(text.slice(0, room))
      break
    }
    parts.push(text)
    used += separator + text.length
  }
  return parts.join("\n\n")
}

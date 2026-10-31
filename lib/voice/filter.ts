import { audienceFilter, visibleDocumentCount } from "@/lib/audience"

/** Same floor as POST /api/chat: an eager filter must not starve the search. */
export const MIN_VISIBLE_DOCUMENTS = 3

export interface VoiceEntityFilter {
  filter: ReturnType<typeof audienceFilter> | null
  /** Null when this assistant does not filter by entity type. */
  entityFilter: { applied: boolean; entity: string } | null
}

/**
 * Decides the file_search filter the same way the written chat does.
 * `searchAll` is the spoken "busca en todos los documentos" retry.
 */
export function voiceEntityFilter(input: {
  entity: string | null
  audienceFilterEnabled: boolean
  documents: Array<{ audience: string[] | null }>
  options: string[]
  searchAll: boolean
}): VoiceEntityFilter {
  const { entity } = input
  if (!entity || !input.audienceFilterEnabled) {
    return { filter: null, entityFilter: null }
  }
  if (input.searchAll) {
    return { filter: null, entityFilter: { applied: false, entity } }
  }
  const visible = visibleDocumentCount(input.documents, input.options, entity)
  const narrow =
    visible >= MIN_VISIBLE_DOCUMENTS && visible < input.documents.length
  return {
    filter: narrow ? audienceFilter(entity) : null,
    entityFilter: { applied: narrow, entity },
  }
}

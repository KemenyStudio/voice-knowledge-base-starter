import type { FileMetadata, FileRow } from "@/types/knowledge"

/** What an MCP client is allowed to see about a library document. */
export interface PublicDocument {
  id: string
  assistantId: string
  name: string
  fileType: string | null
  uploadedAt: string | null
  sizeBytes: number | null
  syncStatus: string
  metadata: Partial<FileMetadata> | null
  audience: string[]
  outdated: boolean
  outdatedNote: string | null
}

export interface SearchPassage {
  documentId: string | null
  name: string
  score: number
  passages: string[]
}

const PASSAGE_MAX = 1200
const PASSAGES_PER_DOCUMENT = 4

/**
 * Keeps only the numeric `summary` object of an evaluation run.
 * Question text, model answers and expected answers stay on the server.
 */
export function extractNumericSummary(data: string | null): Record<string, number> | null {
  if (!data) return null
  try {
    const parsed = JSON.parse(data) as { summary?: unknown }
    if (!parsed.summary || typeof parsed.summary !== "object" || Array.isArray(parsed.summary)) {
      return null
    }
    const out: Record<string, number> = {}
    for (const [key, value] of Object.entries(parsed.summary)) {
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

export function toPublicDocument(row: FileRow): PublicDocument {
  return {
    id: row.id,
    assistantId: row.chatbot_id,
    name: row.file_name,
    fileType: row.file_type,
    uploadedAt: row.uploaded_at,
    sizeBytes: row.size_bytes,
    syncStatus: row.sync_status,
    metadata: row.metadata,
    audience: row.audience ?? [],
    outdated: row.outdated,
    outdatedNote: row.outdated_note,
  }
}

interface RawHit {
  openaiFileId: string
  filename: string
  score: number
  text: string
  fileRowId: string | null
}

/**
 * Groups vector-store hits into library documents. OpenAI file ids are used
 * only to resolve our document id and are not returned.
 */
export function groupSearchHits(
  hits: readonly RawHit[],
  knownDocumentIds: ReadonlySet<string>,
  openaiFileToDocumentId: ReadonlyMap<string, string>,
  maxDocuments: number
): SearchPassage[] {
  const groups = new Map<string, SearchPassage>()
  for (const hit of hits) {
    const fromAttribute =
      hit.fileRowId && knownDocumentIds.has(hit.fileRowId) ? hit.fileRowId : null
    const documentId = fromAttribute ?? openaiFileToDocumentId.get(hit.openaiFileId) ?? null
    const key = documentId ?? `name:${hit.filename}`
    let group = groups.get(key)
    if (!group) {
      group = {
        documentId,
        name: hit.filename,
        score: hit.score,
        passages: [],
      }
      groups.set(key, group)
    }
    group.score = Math.max(group.score, hit.score)
    const text = hit.text.replace(/\s+/g, " ").trim().slice(0, PASSAGE_MAX)
    if (text && !group.passages.includes(text) && group.passages.length < PASSAGES_PER_DOCUMENT) {
      group.passages.push(text)
    }
  }
  return Array.from(groups.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, maxDocuments)
}

import {
  scoreIndexHealth,
  type IndexFacts,
  type IndexHealth,
} from "@/lib/knowledge/index-readiness"

/** Below this, the index still has nothing useful to search. */
export const MIN_SEARCHABLE_CHARS = 40

export function normalizeIndexText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

function kindFor(fileType: string | null): IndexFacts["kind"] {
  const extension = (fileType ?? "").replace(/^\./, "").toLowerCase()
  switch (extension) {
    case "pdf":
    case "docx":
    case "pptx":
    case "doc":
      return extension
    case "txt":
    case "md":
    case "html":
    case "json":
      return "text"
    default:
      return "other"
  }
}

/** Score for text that will actually be attached to the search index. */
export function healthForIndexedText(input: {
  sizeBytes: number
  fileType: string | null
  text: string
  pages: number | null
}): IndexHealth {
  const textChars = normalizeIndexText(input.text).length
  return scoreIndexHealth({
    sizeBytes: Math.max(0, input.sizeBytes),
    kind: kindFor(input.fileType),
    textChars,
    pages: input.pages,
    scanRatio: 0,
    passwordProtected: false,
    extractable: textChars >= MIN_SEARCHABLE_CHARS,
  })
}

/**
 * True when the new text is searchable and the score is higher than the one
 * stored on the row. A tie leaves the current index file alone.
 */
export function shouldReplaceIndex(
  previousScore: number | null,
  health: IndexHealth,
  text: string
): boolean {
  if (normalizeIndexText(text).length < MIN_SEARCHABLE_CHARS) return false
  if (health.score == null) return false
  if (previousScore == null) return health.score > 35
  return health.score > previousScore
}

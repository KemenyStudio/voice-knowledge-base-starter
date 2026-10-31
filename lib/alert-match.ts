/**
 * Matching of document names to find "this is a newer edition of that".
 * Pure functions, no imports, so they can be tested on their own.
 */

/** Words that say "which edition" rather than "which document". */
const EDITION_WORDS = new Set([
  "texto", "compilado", "compilada", "vigente", "actualizado", "actualizada",
  "desactualizado", "desactualizada", "reformado", "reformada", "version",
  "nueva", "nuevo", "reforma", "reformas", "anterior", "final", "copia",
  "de", "la", "el", "los", "las", "del", "que", "se", "y", "a", "en", "para",
  "por", "con", "al", "su", "sus", "o", "pdf", "docx", "txt",
])

const stripAccents = (value: string) =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "")

/** Significant words of a document name, without editions, years and file extensions. */
export function nameTokens(fileName: string): string[] {
  return stripAccents(fileName.toLowerCase())
    .replace(/\.(pdf|docx?|txt|md)$/i, "")
    .replace(/\(.*?\)/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !EDITION_WORDS.has(t) && !/^(19|20)\d{2}$/.test(t))
}

/** "21/2009" style identifier of a regulation, if the name has one. */
export function regulationId(fileName: string): string | null {
  const match = stripAccents(fileName).match(/\b(\d{1,3})\s*[\/:_-]\s*((?:19|20)\d{2})\b/)
  return match ? `${Number(match[1])}/${match[2]}` : null
}

/** 0..1: how likely two names are two editions of the same document. */
export function nameSimilarity(a: string, b: string): number {
  const ta = new Set(nameTokens(a))
  const tb = new Set(nameTokens(b))
  if (ta.size === 0 || tb.size === 0) return 0
  let shared = 0
  ta.forEach((t) => {
    if (tb.has(t)) shared++
  })
  const jaccard = shared / (ta.size + tb.size - shared)
  const idA = regulationId(a)
  const idB = regulationId(b)
  const containment = shared / Math.min(ta.size, tb.size)
  // Same regulation number and one name mostly inside the other: a short file
  // name against a long official title.
  if (idA && idA === idB && containment >= 0.5) return Math.max(jaccard, 0.75)
  return jaccard
}

export const CANDIDATE_THRESHOLD = 0.6
const MAX_CANDIDATES = 3

export interface NamedFile {
  id: string
  file_name: string
  superseded_by?: string | null
}

/** Existing documents that the new one may replace, best first. */
export function supersessionCandidates(
  newFile: NamedFile,
  others: NamedFile[]
): Array<{ file: NamedFile; score: number }> {
  return others
    .filter((o) => o.id !== newFile.id && !o.superseded_by)
    .map((file) => ({ file, score: nameSimilarity(newFile.file_name, file.file_name) }))
    .filter((c) => c.score >= CANDIDATE_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_CANDIDATES)
}


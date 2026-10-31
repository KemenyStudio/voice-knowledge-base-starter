import { explainSyncError } from "@/lib/knowledge/health"

/** A score under this is a weak index. Matches the Biblioteca "índice débil" count. */
export const WEAK_INDEX_BELOW = 70

/** Same window the health report uses before a processing file is called stuck. */
const STUCK_AFTER_MS = 30 * 60 * 1000

export const WORST_DOCUMENT_LIMIT = 5

export interface SummaryFile {
  id: string
  file_name: string
  uploaded_at: string | null
  sync_status: string
  openai_file_id: string | null
  vector_store_id: string | null
  audience: string[] | null
  audience_status: string | null
  index_health_score: number | null
  index_health: { verdict?: string | null; reasons?: string[] | null } | null
  sync_error?: string | null
}

/** Completed files in the assistant's vector store. Not a text-chunk total. */
export interface IndexSnapshot {
  filesCompleted: number
  filesFailed: number
  filesCancelled: number
  filesInProgress: number
  filesTotal: number
  usageBytes: number
}

export interface WorstDocument {
  id: string
  name: string
  score: number | null
  verdict: "good" | "review" | "unknown" | null
  reasons: string[]
  syncStatus: string
  missingAudience: boolean
  needsAttention: boolean
}

export interface LibraryCounts {
  documents: number
  /** Vector-store files that finished indexing. Null when that read failed. */
  indexFiles: number | null
  /**
   * OpenAI does not publish a total of text chunks. This stays null so a
   * caller does not invent one from the file count.
   */
  chunks: null
  ready: number
  needsAttention: number
  missingAudience: number
  weakIndex: number
  processing: number
}

export interface LibrarySummary {
  counts: LibraryCounts
  quality: string
  worst: WorstDocument[]
  index: (IndexSnapshot & { chunks: null }) | null
  sources: {
    documents: "library"
    ready: "library"
    needsAttention: "library"
    missingAudience: "library"
    weakIndex: "library"
    indexFiles: "vector_store" | "unavailable"
    chunks: "unavailable"
  }
}

function isIndexed(file: SummaryFile): boolean {
  return Boolean(file.openai_file_id && file.vector_store_id)
}

function isInFlight(file: SummaryFile, now: number): boolean {
  if (file.sync_status !== "processing" && file.sync_status !== "pending") return false
  if (!file.uploaded_at) return false
  const uploaded = Date.parse(file.uploaded_at)
  if (Number.isNaN(uploaded)) return false
  return now - uploaded <= STUCK_AFTER_MS
}

export function fileNeedsAttention(file: SummaryFile, now: number): boolean {
  if (file.sync_status === "failed") return true
  if (isInFlight(file, now)) return false
  if (!isIndexed(file)) return true
  return file.sync_status === "processing" || file.sync_status === "pending"
}

export function fileIsReady(file: SummaryFile, now: number): boolean {
  return isIndexed(file) && !fileNeedsAttention(file, now) && !isInFlight(file, now)
}

export function fileMissingAudience(file: SummaryFile, audienceEnabled: boolean): boolean {
  if (!audienceEnabled) return false
  if ((file.audience ?? []).length === 0) return true
  return file.audience_status === "unclassified"
}

export function fileWeakIndex(file: SummaryFile): boolean {
  return file.index_health_score != null && file.index_health_score < WEAK_INDEX_BELOW
}

function verdictOf(file: SummaryFile): WorstDocument["verdict"] {
  const verdict = file.index_health?.verdict
  if (verdict === "good" || verdict === "review" || verdict === "unknown") return verdict
  return null
}

function reasonsFor(
  file: SummaryFile,
  now: number,
  missingAudience: boolean
): string[] {
  const reasons: string[] = []
  if (file.sync_status === "failed") {
    reasons.push(explainSyncError(file.sync_error ?? null))
  } else if (!isIndexed(file)) {
    reasons.push("No está en el índice de búsqueda.")
  } else if (
    fileNeedsAttention(file, now) &&
    (file.sync_status === "processing" || file.sync_status === "pending")
  ) {
    reasons.push("La indexación lleva demasiado tiempo.")
  }
  const stored = file.index_health?.reasons
  for (const reason of Array.isArray(stored) ? stored : []) {
    if (reason && !reasons.includes(reason)) reasons.push(reason)
  }
  if (missingAudience) reasons.push("No tiene audiencia.")
  return reasons.slice(0, 3).map((reason) => reason.slice(0, 180))
}

function dominantWeakReason(files: SummaryFile[]): string | null {
  const counts = new Map<string, number>()
  for (const file of files) {
    if (!fileWeakIndex(file)) continue
    const stored = file.index_health?.reasons
    const reason = Array.isArray(stored) ? stored[0]?.trim() : undefined
    if (!reason) continue
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  let best: string | null = null
  let bestCount = 0
  for (const [reason, count] of Array.from(counts.entries())) {
    if (count > bestCount || (count === bestCount && best != null && reason < best)) {
      best = reason
      bestCount = count
    }
  }
  return best
}

export function qualityLine(
  counts: Pick<
    LibraryCounts,
    "documents" | "ready" | "needsAttention" | "missingAudience" | "weakIndex" | "processing"
  >,
  dominantReason: string | null
): string {
  if (counts.documents === 0) return "No hay documentos en la biblioteca."
  const problems: string[] = []
  if (counts.weakIndex > 0) {
    const verb = counts.weakIndex === 1 ? "tiene" : "tienen"
    const trimmed = dominantReason?.replace(/\.$/, "")
    const reason = trimmed
      ? ` (${trimmed.charAt(0).toLocaleLowerCase("es")}${trimmed.slice(1)})`
      : ""
    problems.push(
      `${counts.weakIndex} de ${counts.documents} ${verb} un índice débil${reason}`
    )
  }
  if (counts.missingAudience > 0) {
    problems.push(
      counts.missingAudience === 1 ? "1 sin audiencia" : `${counts.missingAudience} sin audiencia`
    )
  }
  if (counts.needsAttention > 0) {
    problems.push(
      counts.needsAttention === 1
        ? "1 necesita atención"
        : `${counts.needsAttention} necesitan atención`
    )
  }
  if (counts.processing > 0) {
    problems.push(
      counts.processing === 1 ? "1 se está indexando" : `${counts.processing} se están indexando`
    )
  }
  if (problems.length === 0) {
    return counts.documents === 1
      ? "El documento está listo para responder."
      : `Los ${counts.documents} documentos están listos para responder.`
  }
  const ready =
    counts.ready === 1 ? "1 listo para responder" : `${counts.ready} listos para responder`
  return `${problems.join(". ")}. ${ready}.`
}

/**
 * Counts an assistant's library for the Biblioteca strip and for GET
 * /api/files/summary. Pure: the vector-store snapshot is passed in.
 */
export function buildLibrarySummary(
  files: SummaryFile[],
  options: { audienceEnabled: boolean; now?: number; index?: IndexSnapshot | null }
): LibrarySummary {
  const now = options.now ?? Date.now()
  const index = options.index ?? null
  let ready = 0
  let needsAttention = 0
  let missingAudience = 0
  let weakIndex = 0
  let processing = 0

  for (const file of files) {
    if (fileIsReady(file, now)) ready += 1
    if (fileNeedsAttention(file, now)) needsAttention += 1
    if (isInFlight(file, now)) processing += 1
    if (fileMissingAudience(file, options.audienceEnabled)) missingAudience += 1
    if (fileWeakIndex(file)) weakIndex += 1
  }

  const counts: LibraryCounts = {
    documents: files.length,
    indexFiles: index ? index.filesCompleted : null,
    chunks: null,
    ready,
    needsAttention,
    missingAudience,
    weakIndex,
    processing,
  }

  const worst = [...files]
    .sort((a, b) => {
      const attention = Number(fileNeedsAttention(b, now)) - Number(fileNeedsAttention(a, now))
      if (attention !== 0) return attention
      const audience =
        Number(fileMissingAudience(b, options.audienceEnabled)) -
        Number(fileMissingAudience(a, options.audienceEnabled))
      if (audience !== 0) return audience
      const scoreA = a.index_health_score ?? 101
      const scoreB = b.index_health_score ?? 101
      if (scoreA !== scoreB) return scoreA - scoreB
      return a.file_name.localeCompare(b.file_name, "es")
    })
    .slice(0, WORST_DOCUMENT_LIMIT)
    .map((file) => {
      const missing = fileMissingAudience(file, options.audienceEnabled)
      return {
        id: file.id,
        name: file.file_name,
        score: file.index_health_score,
        verdict: verdictOf(file),
        reasons: reasonsFor(file, now, missing),
        syncStatus: file.sync_status,
        missingAudience: missing,
        needsAttention: fileNeedsAttention(file, now),
      }
    })

  return {
    counts,
    quality: qualityLine(counts, dominantWeakReason(files)),
    worst,
    index: index ? { ...index, chunks: null } : null,
    sources: {
      documents: "library",
      ready: "library",
      needsAttention: "library",
      missingAudience: "library",
      weakIndex: "library",
      indexFiles: index ? "vector_store" : "unavailable",
      chunks: "unavailable",
    },
  }
}

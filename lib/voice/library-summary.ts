/**
 * Admin library summary from GET /api/files/summary?chatbotId=.
 * Counts are spoken only when the JSON contains them. `counts.chunks` is
 * null because the index does not publish a fragment total.
 */
export const LIBRARY_HEALTH_SUMMARY_PATH = "/api/files/summary"

export interface LibraryHealthSummary {
  documents: number | null
  chunks: number | null
  ready: number | null
  attention: number | null
  missingAudience: number | null
  weakIndex: number | null
  indexFiles: number | null
  worst: string[]
}

const EMPTY_SUMMARY: LibraryHealthSummary = {
  documents: null,
  chunks: null,
  ready: null,
  attention: null,
  missingAudience: null,
  weakIndex: null,
  indexFiles: null,
  worst: [],
}

export function libraryHealthSummaryUrl(origin: string, chatbotId: string): string {
  const url = new URL(LIBRARY_HEALTH_SUMMARY_PATH, origin)
  url.searchParams.set("chatbotId", chatbotId)
  return url.toString()
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function readCount(source: Record<string, unknown>, key: string): number | null {
  if (!(key in source)) return null
  const value = source[key]
  if (value == null) return null
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value
  return null
}

function readWorst(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const names: string[] = []
  for (const item of value) {
    const row = asRecord(item)
    const name = row && typeof row.name === "string" ? row.name.trim() : ""
    if (!name || names.includes(name)) continue
    names.push(name)
    if (names.length === 5) break
  }
  return names
}

/**
 * Reads the summary route. Absent counts stay null. A null fragment total
 * stays null so speech can say the index does not publish one.
 */
export function parseLibraryHealthSummary(data: unknown): LibraryHealthSummary {
  const root = asRecord(data)
  if (!root) return { ...EMPTY_SUMMARY }
  const counts = asRecord(root.counts) ?? root
  return {
    documents: readCount(counts, "documents"),
    chunks: readCount(counts, "chunks"),
    ready: readCount(counts, "ready"),
    attention: readCount(counts, "needsAttention"),
    missingAudience: readCount(counts, "missingAudience"),
    weakIndex: readCount(counts, "weakIndex"),
    indexFiles: readCount(counts, "indexFiles"),
    worst: readWorst(root.worst),
  }
}

function countLabel(value: number, one: string, many: string): string {
  const shown = Number.isInteger(value) ? String(value) : String(Math.round(value * 10) / 10)
  return `${shown} ${value === 1 ? one : many}`
}

function joinNames(names: string[]): string {
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(", ")} y ${names[names.length - 1]}`
}

/** Spanish sentence using only figures that were in the payload. */
export function speakLibraryHealthSummary(summary: LibraryHealthSummary): string {
  const parts: string[] = []
  if (summary.documents != null) parts.push(countLabel(summary.documents, "documento", "documentos"))
  if (summary.ready != null) parts.push(countLabel(summary.ready, "listo", "listos"))
  if (summary.attention != null) {
    parts.push(
      countLabel(summary.attention, "que necesita atención", "que necesitan atención")
    )
  }
  if (summary.missingAudience != null) {
    parts.push(countLabel(summary.missingAudience, "sin audiencia", "sin audiencia"))
  }
  if (summary.weakIndex != null) {
    parts.push(countLabel(summary.weakIndex, "con índice débil", "con índice débil"))
  }
  if (summary.indexFiles != null) {
    parts.push(countLabel(summary.indexFiles, "en el índice", "en el índice"))
  }
  if (summary.chunks != null) {
    parts.push(countLabel(summary.chunks, "fragmento", "fragmentos"))
  }

  const sentences: string[] = []
  if (parts.length === 0) {
    sentences.push("El resumen de la biblioteca no trajo números. No invento cifras.")
  } else {
    sentences.push(`Resumen de la biblioteca: ${parts.join(", ")}.`)
  }
  if (summary.chunks == null) {
    sentences.push("El índice no publica un total de fragmentos.")
  }
  if (summary.indexFiles == null && parts.length > 0) {
    sentences.push("El conteo de archivos en el índice no vino en el resumen.")
  }
  if (summary.worst.length > 0) {
    sentences.push(`Los que más atención piden: ${joinNames(summary.worst)}.`)
  }
  return sentences.join(" ")
}

export const LIBRARY_SUMMARY_UNAVAILABLE =
  "El resumen de salud de la biblioteca no está disponible. No invento documentos, fragmentos ni puntajes."

export const LIBRARY_SUMMARY_ADMIN_ONLY =
  "El resumen de salud de la biblioteca es solo para administradores del equipo."

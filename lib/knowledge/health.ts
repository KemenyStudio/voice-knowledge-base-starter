import type { FileRow } from "@/types/knowledge"

export type HealthIssueKind =
  | "no_file"
  | "not_indexed"
  | "failed"
  | "stuck"
  | "untagged"
  | "outdated"

export interface HealthIssue {
  kind: HealthIssueKind
  fileId: string
  fileName: string
  /** Short explanation for the admin, in Spanish. */
  detail: string
  /** Actions that make sense for this issue. */
  actions: Array<"retry" | "edit" | "delete">
}

export interface HealthReport {
  totals: {
    documents: number
    ready: number
    processing: number
    failed: number
    notIndexed: number
  }
  issues: HealthIssue[]
  untaggedAudience: number
  lastDocumentAt: string | null
}

const STUCK_AFTER_MS = 30 * 60 * 1000

/** Plain-language hint for the most common OpenAI parsing errors. */
export function explainSyncError(error: string | null): string {
  if (!error) return "La indexación falló."
  if (/empty/i.test(error)) {
    return "El archivo parece vacío o es un escaneo sin texto. Sube una versión con texto seleccionable."
  }
  if (/unsupported|format/i.test(error)) {
    return "El formato del archivo no es compatible con la búsqueda."
  }
  return `La indexación falló: ${error.slice(0, 160)}`
}

/**
 * Turns the library rows into a list of things an admin can fix. Pure, so it
 * can be tested without a database.
 */
export function buildHealthReport(
  files: FileRow[],
  options: { audienceEnabled: boolean; now?: number } = { audienceEnabled: false }
): HealthReport {
  const now = options.now ?? Date.now()
  const issues: HealthIssue[] = []
  const totals = { documents: files.length, ready: 0, processing: 0, failed: 0, notIndexed: 0 }
  let untaggedAudience = 0
  let lastDocumentAt: string | null = null

  for (const file of files) {
    if (!lastDocumentAt || file.uploaded_at > lastDocumentAt) {
      lastDocumentAt = file.uploaded_at
    }
    if (file.audience_status === "unclassified") untaggedAudience += 1

    const indexed = Boolean(file.openai_file_id && file.vector_store_id)

    if (file.sync_status === "failed") {
      totals.failed += 1
      issues.push({
        kind: "failed",
        fileId: file.id,
        fileName: file.file_name,
        detail: explainSyncError(file.sync_error),
        actions: file.blob_name ? ["retry", "delete"] : ["delete"],
      })
    } else if (file.sync_status === "processing") {
      totals.processing += 1
      const age = now - new Date(file.uploaded_at).getTime()
      if (age > STUCK_AFTER_MS) {
        issues.push({
          kind: "stuck",
          fileId: file.id,
          fileName: file.file_name,
          detail: "Lleva más de 30 minutos indexándose. Reintenta la indexación.",
          actions: file.blob_name ? ["retry"] : ["delete"],
        })
      }
    } else if (!indexed) {
      totals.notIndexed += 1
      issues.push(
        file.blob_name
          ? {
              kind: "not_indexed",
              fileId: file.id,
              fileName: file.file_name,
              detail: "Está guardado pero no está en el índice de búsqueda, así que el asistente no lo usa.",
              actions: ["retry", "delete"],
            }
          : {
              kind: "no_file",
              fileId: file.id,
              fileName: file.file_name,
              detail: "Tiene una entrada pero no hay archivo guardado ni indexado, así que el asistente no lo usa. Elimina la entrada y sube el documento otra vez.",
              actions: ["delete"],
            }
      )
    } else {
      totals.ready += 1
    }

    const meta = file.metadata ?? {}
    const missing: string[] = []
    if (!meta.type_tag) missing.push("tipo")
    if (!meta.target_tag?.length) missing.push("a quién va dirigido")
    if (missing.length > 0) {
      issues.push({
        kind: "untagged",
        fileId: file.id,
        fileName: file.file_name,
        detail: `Falta: ${missing.join(" y ")}.`,
        actions: ["edit"],
      })
    }

    if (file.outdated) {
      issues.push({
        kind: "outdated",
        fileId: file.id,
        fileName: file.file_name,
        detail: file.outdated_note
          ? `Marcado como desactualizado: ${file.outdated_note}`
          : "Marcado como desactualizado.",
        actions: ["edit", "delete"],
      })
    }
  }

  return {
    totals,
    issues,
    untaggedAudience: options.audienceEnabled ? untaggedAudience : 0,
    lastDocumentAt,
  }
}

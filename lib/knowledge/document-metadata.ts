import { foldText, pickOptions } from "@/lib/audience"
import {
  resolveAudienceLabel,
  type AudienceReading,
} from "@/lib/knowledge/audience-label"
import type { FileMetadata } from "@/types/knowledge"

/** Fields Astra can write. `nombre` is stored only when the current name is empty. */
export const ASTRA_METADATA_FIELDS = [
  "nombre",
  "tipo",
  "audiencia",
  "fuente",
  "contexto",
] as const

export type AstraMetadataField = (typeof ASTRA_METADATA_FIELDS)[number]

export interface DocumentMetadataProposal {
  /** Display title. Saved only when the document name is empty. */
  nombre: string
  tipo: string
  /** Labels for `metadata.target_tag`. Existing spelling, or a real new sector. */
  audiencia: string[]
  /**
   * `files.audience`. Empty unless the document applies only to configured
   * profiles, so a new sector never hides the file from everyone else.
   */
  audienciaFiltro: string[]
  fuente: string[]
  contexto: string
}

const CONTEXT_MAX = 500
const NAME_MAX = 180
const TYPE_MAX = 80

function cleanLine(value: string, max: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, max)
}

function sameFolded(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const wanted = new Set(right.map((item) => foldText(item)))
  return left.every((item) => wanted.has(foldText(item)))
}

function uniqueClean(values: string[], max: number): string[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const value of values) {
    const label = cleanLine(value, 80)
    const folded = foldText(label)
    if (label.length < 2 || seen.has(folded)) continue
    seen.add(folded)
    labels.push(label)
    if (labels.length === max) break
  }
  return labels
}

function canonicalize(label: string, known: string[]): string {
  const folded = foldText(label)
  return known.find((item) => foldText(item) === folded) ?? label
}

/**
 * Turns Astra's reading into labels an admin can edit.
 * A sector that is not in the configured list stays under its own name.
 * It is never rewritten to the closest existing profile.
 */
export function proposalFromReading(input: {
  nombre: string
  tipo: string
  fuente: string[]
  contexto: string
  reading: AudienceReading
  options: string[]
  knownLabels: string[]
  knownTypes?: string[]
}): DocumentMetadataProposal {
  const resolved = resolveAudienceLabel(input.options, input.reading)
  const labels = (resolved?.labels ?? []).map((label) =>
    canonicalize(label, input.knownLabels)
  )
  const unique: string[] = []
  for (const label of labels) {
    if (unique.some((item) => foldText(item) === foldText(label))) continue
    unique.push(label)
  }
  return {
    nombre: cleanLine(input.nombre, NAME_MAX),
    tipo: canonicalize(cleanLine(input.tipo, TYPE_MAX), input.knownTypes ?? []),
    audiencia: unique,
    audienciaFiltro: resolved?.audience ?? [],
    fuente: uniqueClean(input.fuente, 6),
    contexto: cleanLine(input.contexto, CONTEXT_MAX),
  }
}

export function hasMetadataGap(file: {
  file_name: string
  metadata: Partial<FileMetadata> | null
}): boolean {
  const meta = file.metadata
  if (!file.file_name.trim()) return true
  if (!meta?.type_tag?.trim()) return true
  if (!meta.target_tag?.length) return true
  if (!meta.entity_tag?.length) return true
  if (!meta.context?.trim()) return true
  return false
}

/**
 * Fills only empty fields. A name, type, audience, source or context that
 * already has a value is left as the admin saved it.
 */
export function applyMetadataProposal(
  current: { fileName: string; metadata: Partial<FileMetadata> | null },
  proposal: DocumentMetadataProposal
): { fileName: string; metadata: FileMetadata; wrote: AstraMetadataField[] } {
  const meta = current.metadata
  const wrote: AstraMetadataField[] = []
  let fileName = current.fileName
  if (!fileName.trim() && proposal.nombre.trim()) {
    fileName = proposal.nombre.trim()
    wrote.push("nombre")
  }

  const type_tag = meta?.type_tag?.trim() || ""
  const nextType = type_tag || proposal.tipo.trim()
  if (!type_tag && nextType) wrote.push("tipo")

  const target = meta?.target_tag?.length ? meta.target_tag : proposal.audiencia
  if (!meta?.target_tag?.length && target.length > 0) wrote.push("audiencia")

  const source = meta?.entity_tag?.length ? meta.entity_tag : proposal.fuente
  if (!meta?.entity_tag?.length && source.length > 0) wrote.push("fuente")

  const context = meta?.context?.trim() || ""
  const nextContext = context || proposal.contexto.trim()
  if (!context && nextContext) wrote.push("contexto")

  return {
    fileName,
    metadata: {
      type_tag: nextType,
      target_tag: target,
      entity_tag: source,
      context: nextContext,
    },
    wrote,
  }
}

/**
 * Filter audience to store with the labels the admin kept.
 * Returns null when there was no proposal, so an edit does not change the filter.
 * A label outside the configured profiles clears the filter instead of forcing one.
 */
export function audienceForSavedLabels(
  labels: string[],
  options: string[],
  proposal: Pick<DocumentMetadataProposal, "audiencia" | "audienciaFiltro"> | null
): string[] | null {
  if (!proposal) return null
  if (sameFolded(labels, proposal.audiencia)) return proposal.audienciaFiltro
  const known = pickOptions(options, labels)
  const hasNewSector = labels.some(
    (label) => !known.some((option) => foldText(option) === foldText(label))
  )
  if (hasNewSector || known.length !== labels.length) return []
  return known
}

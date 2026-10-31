import { foldText, pickOptions } from "@/lib/audience"

/** What the model read about who a document is for. */
export interface AudienceReading {
  /** Configured profiles the text names as addressees. */
  knownProfiles: string[]
  /**
   * True only when the document applies to those known profiles and to
   * nobody outside that list. A broader statute or another sector is false.
   */
  limitedToKnownProfiles: boolean
  /** Audiences that are not in the configured list. */
  otherAudiences: string[]
  reason: string
}

export interface ResolvedAudienceLabel {
  /**
   * Filter audience. Empty means the document stays visible to every profile,
   * which is required when it also covers someone outside the configured list.
   */
  audience: string[]
  /** Labels stored on the document (`metadata.target_tag`). At least one. */
  labels: string[]
  reason: string
}

const LABEL_MAX = 60
const LABEL_COUNT = 6

function cleanLabel(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX)
}

/** Drops blanks and labels that are too vague to name an audience. */
export function normalizeFreeLabels(values: string[]): string[] {
  const seen = new Set<string>()
  const labels: string[] = []
  for (const value of values) {
    const label = cleanLabel(value)
    const folded = foldText(label)
    if (label.length < 3 || seen.has(folded)) continue
    if (
      folded === "todos" ||
      folded === "todas" ||
      folded === "general" ||
      folded === "otro" ||
      folded === "otros" ||
      folded === "n/a" ||
      folded === "na" ||
      folded === "ninguno" ||
      folded === "ninguna"
    ) {
      continue
    }
    seen.add(folded)
    labels.push(label)
    if (labels.length === LABEL_COUNT) break
  }
  return labels
}

/**
 * Turns a reading into the labels to store. A document is narrowed to the
 * configured profiles only when the reading says it applies to those profiles
 * and to nobody else. Any other audience is kept as its own label and the
 * filter audience stays empty, so the document is not hidden from a profile
 * it may still apply to.
 */
export function resolveAudienceLabel(
  options: string[],
  reading: AudienceReading
): ResolvedAudienceLabel | null {
  const known = pickOptions(options, reading.knownProfiles)
  const knownFolded = new Set(known.map((label) => foldText(label)))
  const others = normalizeFreeLabels(reading.otherAudiences).filter(
    (label) => !knownFolded.has(foldText(label))
  )
  const reason = reading.reason.replace(/\s+/g, " ").trim().slice(0, 200)

  if (
    reading.limitedToKnownProfiles &&
    known.length > 0 &&
    others.length === 0
  ) {
    return { audience: known, labels: known, reason }
  }

  const labels = [...others]
  for (const label of known) {
    if (!labels.some((item) => foldText(item) === foldText(label))) {
      labels.push(label)
    }
  }
  if (labels.length === 0) return null
  return { audience: [], labels: labels.slice(0, LABEL_COUNT), reason }
}

/** A ready, indexed document that still has no "dirigido a" label, or no audience decision. */
export function needsAudienceLabel(file: {
  audience_status?: string | null
  sync_status?: string | null
  vector_store_id?: string | null
  metadata?: { target_tag?: string[] | null } | null
}): boolean {
  if (file.sync_status !== "ready" || !file.vector_store_id) return false
  const missingTag = !(file.metadata?.target_tag?.length)
  const unclassified = (file.audience_status ?? "unclassified") === "unclassified"
  return missingTag || unclassified
}

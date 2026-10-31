/**
 * Audience = the profiles a document applies to. The labels come from the
 * assistant (`chatbots.audience_options`), not from this file. Documents carry
 * an `audience` list; an empty list means "applies to everyone" and
 * unclassified documents are treated the same way, so a filter can never hide
 * a document nobody has reviewed.
 *
 * In the vector store the audience is written as exclusion attributes:
 * `excl_<entity>: true` for every configured entity type the document does NOT
 * apply to. The search filter is then `excl_<entity> != true`, which keeps every
 * document that has no such attribute (verified against the OpenAI API).
 */

export const MAX_AUDIENCE_OPTIONS = 8
const LABEL_MAX = 60

export function foldText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
}

export function slugify(value: string): string {
  return foldText(value)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
}

/** Trimmed, de-duplicated, at most MAX_AUDIENCE_OPTIONS labels with distinct slugs. */
export function normalizeOptions(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : []
  const seen = new Set<string>()
  const result: string[] = []
  for (const item of list) {
    if (typeof item !== "string") continue
    const label = item.replace(/\s+/g, " ").trim().slice(0, LABEL_MAX)
    const slug = slugify(label)
    if (!label || !slug || seen.has(slug)) continue
    seen.add(slug)
    result.push(label)
    if (result.length === MAX_AUDIENCE_OPTIONS) break
  }
  return result
}

/** Canonical option for a label typed by a user or returned by a model. */
export function findOption(options: string[], value: string): string | null {
  const folded = foldText(value)
  return options.find((option) => foldText(option) === folded) ?? null
}

/** Keeps only labels that are configured options, in the configured order. */
export function pickOptions(options: string[], values: string[]): string[] {
  const wanted = new Set(values.map((v) => foldText(v)))
  return options.filter((option) => wanted.has(foldText(option)))
}

/**
 * Optional tag shorthand stored on the assistant (`chatbots.audience_aliases`).
 * Keys are matched after folding case and accents. Values are profile labels.
 */
export function normalizeAliases(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {}
  const out: Record<string, string[]> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const folded = foldText(key)
    if (!folded || !Array.isArray(value)) continue
    const labels = value
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.replace(/\s+/g, " ").trim())
      .filter(Boolean)
    if (labels.length > 0) out[folded] = labels
  }
  return out
}

function optionsForTag(
  tag: string,
  options: string[],
  aliases: Record<string, string[]>
): string[] {
  const folded = foldText(tag)
  if (!folded) return []
  const direct = options.filter((option) => {
    const optionFolded = foldText(option)
    return optionFolded === folded || optionFolded.startsWith(`${folded} `)
  })
  if (direct.length > 0) return direct
  return pickOptions(options, aliases[folded] ?? [])
}

/**
 * Audience implied by the free-form tags a document already has. A tag
 * matches an option when they are equal or when the tag is the start of the
 * option ("Cliente" -> "Cliente interno" and "Cliente externo"). `aliases`
 * come from the assistant and are empty unless that team configured them.
 * Returns null when any tag cannot be mapped: narrowing a document to part of
 * its tags could hide it from someone it applies to, so those are left for a
 * person to review.
 */
export function tagsToAudience(
  tags: string[],
  options: string[],
  aliases: Record<string, string[]> = {}
): string[] | null {
  const matched = new Set<string>()
  const usable = tags.filter((tag) => foldText(tag))
  if (usable.length === 0) return null
  for (const tag of usable) {
    const found = optionsForTag(tag, options, aliases)
    if (found.length === 0) return null
    found.forEach((option) => matched.add(option))
  }
  return options.filter((option) => matched.has(option))
}

/** Vector store attributes for a document's audience (see the file header). */
export function audienceAttributes(
  options: string[],
  audience: string[]
): Record<string, boolean> {
  const applies = pickOptions(options, audience)
  if (applies.length === 0) return {}
  const attributes: Record<string, boolean> = {}
  for (const option of options) {
    if (!applies.includes(option)) attributes[`excl_${slugify(option)}`] = true
  }
  return attributes
}

/** file_search filter that skips documents marked as not applying to `entity`. */
export function audienceFilter(entity: string) {
  return {
    type: "ne" as const,
    key: `excl_${slugify(entity)}`,
    value: true,
  }
}

/** Documents still visible once the filter for `entity` is applied. */
export function visibleDocumentCount(
  documents: Array<{ audience: string[] | null }>,
  options: string[],
  entity: string
): number {
  return documents.filter((doc) => {
    const applies = pickOptions(options, doc.audience ?? [])
    return applies.length === 0 || applies.includes(entity)
  }).length
}

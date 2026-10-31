export const MAX_PROMPT_NOTES = 10
export const PROMPT_NOTE_MAX_LENGTH = 300

/** Cleans a list of admin notes: trimmed, non-empty, bounded. */
export function normalizeNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.replace(/\s+/g, " ").trim().slice(0, PROMPT_NOTE_MAX_LENGTH))
    .filter(Boolean)
    .slice(0, MAX_PROMPT_NOTES)
}

/** Instructions block for the notes an admin wrote for this assistant. */
export function promptNotesBlock(notes: unknown): string {
  const list = normalizeNotes(notes)
  if (list.length === 0) return ""
  return `

# Indicaciones del equipo

Estas notas las escribió el equipo que administra el asistente; síguelas cuando apliquen a la pregunta:
${list.map((note) => `- ${note}`).join("\n")}`
}

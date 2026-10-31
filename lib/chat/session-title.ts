const PLACEHOLDER_TITLES = new Set(["New Conversation", "Conversación"])

/** Titles stored before the product was in Spanish, or when a chat has no question yet. */
export function isPlaceholderTitle(title: string | null | undefined): boolean {
  return !title || PLACEHOLDER_TITLES.has(title.trim())
}

/** Short label for a conversation, taken from the question the person asked. */
export function titleFrom(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim()
  if (!oneLine) return "Conversación"
  return oneLine.length > 60 ? `${oneLine.slice(0, 57)}...` : oneLine
}

/** What Historial shows: the saved name, or the question when the name is a placeholder. */
export function sessionHeading(
  title: string | null | undefined,
  message: string
): string {
  if (!isPlaceholderTitle(title)) return (title as string).trim()
  return titleFrom(message)
}

/**
 * Title a person typed. Returns null when it is empty or longer than 120
 * characters. Control characters become spaces.
 */
export function cleanSessionTitle(raw: string): string | null {
  const clean = raw.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim()
  if (clean.length < 1 || clean.length > 120) return null
  return clean
}

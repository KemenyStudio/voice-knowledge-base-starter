export type AnswerLanguage = "en" | "es"

const SPANISH =
  /\b(el|la|los|las|un|una|de|del|que|qué|cómo|como|para|por|con|está|esta|obligación|obligacion|plazo|sanción|sancion|artículo|articulo|cuál|cual|cuáles|cuales|dónde|donde|según|tambien|también|más)\b/gi

const ENGLISH =
  /\b(the|what|which|how|when|where|does|do|is|are|was|were|obligation|deadline|sanction|article|please|about|should|can|could|would|this|that|from|with|for|and)\b/gi

/**
 * Spanish is the default. English is chosen only when the question clearly
 * reads as English and Spanish markers do not lead.
 */
export function questionLanguage(text: string): AnswerLanguage {
  const spanish = text.match(SPANISH)?.length ?? 0
  const english = text.match(ENGLISH)?.length ?? 0
  if (english >= 2 && english > spanish) return "en"
  return "es"
}

/** Appended last so it overrides a Spanish-only system prompt for this turn. */
export function languageInstruction(language: AnswerLanguage): string {
  if (language === "es") return ""
  return `

# Idioma de esta respuesta
La pregunta está en inglés. Responde toda la respuesta en inglés, incluidas las aclaraciones. La sección de referencias se titula "References:". No traduzcas los nombres oficiales de los documentos. Esta instrucción tiene prioridad sobre cualquier indicación anterior de responder en español.`
}

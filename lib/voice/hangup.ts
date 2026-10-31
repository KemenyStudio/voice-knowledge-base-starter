import { foldText } from "@/lib/audience"

const EXACT = new Set([
  "cuelga",
  "cuelgue",
  "colgar",
  "colga",
  "adios",
  "hasta luego",
  "hasta pronto",
  "chao",
  "chau",
  "nos vemos",
  "bye",
  "goodbye",
  "good bye",
  "hang up",
  "end the call",
])

/** Shown in Ajustes. These stay on; the user does not set or type them. */
export const HANGUP_PHRASES_DISPLAY = [
  "cuelga",
  "colgar",
  "termina la llamada",
  "corta la llamada",
  "adiós",
  "hasta luego",
  "chao",
] as const

const PHRASES = [
  "termina la llamada",
  "terminar la llamada",
  "corta la llamada",
  "cortar la llamada",
  "cuelga la llamada",
  "fin de la llamada",
  "end the call",
  "end this call",
  "hang up",
  "hang up the call",
  "please end the call",
  "please hang up",
]

/**
 * True when the caller is ending the call, not greeting and then asking
 * something. "adiós, ¿qué dice la ley?" stays on the line.
 */
export function isHangupUtterance(text: string): boolean {
  const folded = foldText(text).replace(/[¡!¿?.,;:]/g, "").replace(/\s+/g, " ").trim()
  if (!folded || folded.length > 60) return false
  if (/\b(que|cual|como|cuando|donde|what|which|when|where|why|who|how)\b/.test(folded)) {
    return false
  }
  if (EXACT.has(folded)) return true
  if (/^(adios|cuelga|colgar|chao|chau|goodbye|bye|hang up|end the call)\b/.test(folded)) {
    return true
  }
  return PHRASES.some(
    (phrase) => folded === phrase || folded.startsWith(`${phrase} `) || folded.endsWith(` ${phrase}`)
  )
}

/**
 * Clarifying questions. When a question is really ambiguous the model answers
 * with a single `<clarify>{...}</clarify>` tag instead of an answer; the
 * server turns it into a question with option buttons. It is the exception:
 * never twice in a row, never when the entity type is already known.
 */

export interface Clarify {
  question: string
  options: string[]
  /** "entity_type": the chosen option is also saved as the user's entity type. */
  kind?: "entity_type"
}

const OPEN = "<clarify"

export function clarifyInstructions(input: {
  entityOptions: string[]
  entityKnown: boolean
}): string {
  const askEntity = input.entityOptions.length >= 2 && !input.entityKnown
  return `

# Aclaraciones (solo si son imprescindibles)

Responde directamente siempre que puedas. Solo si la pregunta es realmente ambigua y la respuesta correcta cambia de forma sustancial según un dato que no puedes inferir, no respondas: devuelve ÚNICAMENTE esta etiqueta, sin más texto:
<clarify>{"question":"pregunta breve","options":["opción 1","opción 2"]}</clarify>
Da entre 2 y 5 opciones cortas y excluyentes. Nunca pidas una aclaración si ya tienes contexto suficiente.${
    askEntity
      ? `
Si el dato que falta es el perfil del usuario, añade "kind":"entity_type" (las opciones se completan automáticamente).`
      : ""
  }`
}

/** The line that tells the model who is asking. */
export function userContextLine(entity: string | null): string {
  return entity
    ? `

# Contexto del usuario

El usuario trabaja con el perfil "${entity}". Cuando los documentos difieran según el perfil, responde para ese perfil y señala si algo aplica solo a otros.`
    : ""
}

/**
 * Holds back streamed text while it is still unclear whether the answer is a
 * clarification, so the browser never briefly shows raw tag markup.
 */
export class ClarifyGate {
  private buffer = ""
  private mode: "undecided" | "clarify" | "text" = "undecided"

  /** Text that may be sent to the browser now. */
  push(delta: string): string {
    if (this.mode === "text") return delta
    if (this.mode === "clarify") return ""
    this.buffer += delta
    const head = this.buffer.trimStart()
    if (head.length < OPEN.length && OPEN.startsWith(head)) return ""
    if (head.startsWith(OPEN)) {
      this.mode = "clarify"
      return ""
    }
    this.mode = "text"
    const out = this.buffer
    this.buffer = ""
    return out
  }

  /** Anything still held when the stream ends (a short, non-clarify answer). */
  flush(): string {
    if (this.mode !== "undecided") return ""
    const out = this.buffer
    this.buffer = ""
    return out
  }
}

export interface ParsedAnswer {
  text: string
  clarify: Clarify | null
}

const FALLBACK_QUESTION =
  "¿Puedes darme un poco más de detalle sobre lo que necesitas?"

export function parseClarify(
  raw: string,
  input: { entityOptions: string[]; entityKnown: boolean }
): ParsedAnswer {
  if (!raw.trimStart().toLowerCase().startsWith(OPEN)) {
    return { text: raw, clarify: null }
  }

  const match = raw.match(/<clarify>([\s\S]*?)<\/clarify>/i)
  try {
    if (!match) throw new Error("unterminated")
    const data = JSON.parse(match[1]) as {
      question?: unknown
      options?: unknown
      kind?: unknown
    }
    const question =
      typeof data.question === "string" ? data.question.trim().slice(0, 300) : ""
    if (!question) throw new Error("no question")

    const asksEntity =
      data.kind === "entity_type" &&
      input.entityOptions.length >= 2 &&
      !input.entityKnown
    if (asksEntity) {
      return {
        text: question,
        clarify: { question, options: input.entityOptions, kind: "entity_type" },
      }
    }

    const seen = new Set<string>()
    const options: string[] = []
    for (const item of Array.isArray(data.options) ? data.options : []) {
      if (typeof item !== "string") continue
      const label = item.replace(/\s+/g, " ").trim().slice(0, 80)
      const key = label.toLowerCase()
      if (!label || seen.has(key)) continue
      seen.add(key)
      options.push(label)
    }
    if (options.length < 2) return { text: question, clarify: null }
    return {
      text: question,
      clarify: { question, options: options.slice(0, 5) },
    }
  } catch {
    const stripped = raw.replace(/<\/?clarify>/gi, "").trim()
    const looksLikeJson = stripped.startsWith("{")
    return { text: looksLikeJson ? FALLBACK_QUESTION : stripped, clarify: null }
  }
}

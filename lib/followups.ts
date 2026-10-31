import { aiConfig, getOpenAI } from "@/lib/openai"

const MAX_FOLLOW_UPS = 3

/**
 * Up to three short questions the user is likely to ask next, based on the
 * question and the answer just given. Best effort: any failure returns [] so
 * the answer itself is never affected.
 */
export async function generateFollowUps(input: {
  assistantName: string
  question: string
  answer: string
  language?: "en" | "es"
}): Promise<string[]> {
  try {
    const response = await getOpenAI().responses.create({
      model: aiConfig.utilityModel,
      reasoning: { effort: aiConfig.utilityEffort },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "follow_ups",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["questions"],
            properties: {
              questions: { type: "array", items: { type: "string" } },
            },
          },
        },
      },
      max_output_tokens: 400,
      store: false,
      instructions: `Eres el asistente "${input.assistantName}". Propón hasta ${MAX_FOLLOW_UPS} preguntas de seguimiento que el usuario probablemente haría después de esta respuesta.
- Cada una debe poder enviarse tal cual, en el idioma del usuario, en primera persona, de máximo 110 caracteres.
- Deben profundizar en lo ya respondido (plazos, excepciones, sanciones, ejemplos, qué cambió), no repetirlo.
- No uses numeración ni comillas. Si no hay un seguimiento útil devuelve una lista vacía.`,
      input: `Pregunta del usuario:\n${input.question}\n\nRespuesta:\n${input.answer.slice(0, 6000)}${
        input.language === "en"
          ? "\n\nThe user wrote in English. Write every follow-up question in English."
          : ""
      }`,
    })
    return parseFollowUps(response.output_text)
  } catch (error) {
    console.error("generateFollowUps", error)
    return []
  }
}

export function parseFollowUps(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { questions?: unknown }
    if (!Array.isArray(parsed.questions)) return []
    return parsed.questions
      .filter((q): q is string => typeof q === "string")
      .map((q) => q.replace(/\s+/g, " ").trim())
      .filter((q) => q.length > 3 && q.length <= 200)
      .slice(0, MAX_FOLLOW_UPS)
  } catch {
    return []
  }
}

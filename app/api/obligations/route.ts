import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import {
  extractObligationsFromAnswer,
  parseObligationPayload,
  type ObligationRow,
} from "@/lib/chat/obligations"
import { updateMessageMeta } from "@/lib/conversations"
import { HttpError, errorResponse } from "@/lib/http"
import { aiConfig, getOpenAI } from "@/lib/openai"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  chatbotId: uuidSchema,
  messageId: z.string().min(1).max(200),
})

/**
 * Builds a table of obligations, deadlines and sanctions from one saved
 * answer. It does not search the library again.
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const { chatbotId, messageId } = bodySchema.parse(await req.json())
    await requireChatbotAccess(supabase, user.id, chatbotId, "member")

    const { data, error } = await supabase
      .from("chat_messages")
      .select("id, role, content, meta")
      .eq("id", messageId)
      .eq("user_id", user.id)
      .eq("chatbot_id", chatbotId)
      .maybeSingle()
    if (error) throw error
    if (!data || data.role !== "assistant") {
      throw new HttpError(404, "No se encontró esa respuesta.")
    }

    const cached = data.meta?.obligations
    if (Array.isArray(cached)) {
      return NextResponse.json({ rows: cached as ObligationRow[] })
    }

    const fromAnswer = extractObligationsFromAnswer(data.content)
    const rows = fromAnswer.length > 0 ? fromAnswer : await extractWithModel(data.content)

    await updateMessageMeta(getAdminClient(), {
      id: messageId,
      userId: user.id,
      patch: { obligations: rows },
    }).catch((metaError) => {
      console.error("obligations meta", metaError)
    })

    return NextResponse.json({ rows })
  } catch (error) {
    return errorResponse(error, "POST /api/obligations")
  }
}

async function extractWithModel(answer: string): Promise<ObligationRow[]> {
  const response = await getOpenAI().responses.create({
    model: aiConfig.utilityModel,
    reasoning: { effort: aiConfig.utilityEffort },
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "obligations",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["rows"],
          properties: {
            rows: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["obligation", "deadline", "sanction"],
                properties: {
                  obligation: { type: "string" },
                  deadline: { type: "string" },
                  sanction: { type: "string" },
                },
              },
            },
          },
        },
      },
    },
    max_output_tokens: 2000,
    store: false,
    instructions: `Extrae de la respuesta una tabla de obligaciones, plazos y sanciones.
- Usa solo lo que la respuesta dice. No completes con conocimiento externo ni inventes cifras.
- Si la respuesta no menciona una obligación, un plazo o una sanción, deja ese campo vacío.
- Si no hay nada que tabular, devuelve rows vacío.
- Conserva el idioma de la respuesta.`,
    input: answer.slice(0, 12000),
  })
  return parseObligationPayload(response.output_text)
}

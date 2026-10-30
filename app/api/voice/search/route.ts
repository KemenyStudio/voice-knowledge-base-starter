import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { uuidSchema } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { NO_INDEX_MESSAGE, loadVoiceContext } from "@/lib/voice/context"
import { voiceEntityFilter } from "@/lib/voice/filter"
import { answerFromLibrary } from "@/lib/voice/library-search"

export const maxDuration = 120
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  chatbotId: uuidSchema,
  query: z.string().trim().min(1).max(8000),
  searchAll: z.boolean().optional(),
})

/**
 * file_search against the assistant's vector store, for an in-progress call.
 * The browser forwards the Realtime tool call here; the OpenAI key stays here.
 */
export async function POST(req: NextRequest) {
  try {
    const body = bodySchema.parse(await req.json())
    const ctx = await loadVoiceContext(body.chatbotId)
    const { filter, entityFilter } = voiceEntityFilter({
      entity: ctx.entity,
      audienceFilterEnabled: ctx.chatbot.audience_filter,
      documents: ctx.documents,
      options: ctx.options,
      searchAll: body.searchAll === true,
    })

    if (!ctx.chatbot.vector_store_id) throw new HttpError(409, NO_INDEX_MESSAGE)
    const answer = await answerFromLibrary({
      supabase: ctx.supabase,
      chatbot: ctx.chatbot,
      vectorStoreId: ctx.chatbot.vector_store_id,
      entity: ctx.entity,
      filter,
      entityFilter,
      query: body.query,
      length: ctx.callSettings.length,
    })

    return NextResponse.json({
      output: JSON.stringify({
        respuesta: answer.respuesta,
        citado: answer.cited,
        documentos: answer.documentos,
        filtro_entidad: answer.filtro_entidad,
      }),
      citations: answer.citations,
    })
  } catch (error) {
    return errorResponse(error, "POST /api/voice/search")
  }
}

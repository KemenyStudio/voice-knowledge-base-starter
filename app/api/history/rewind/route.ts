import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  chatbotId: uuidSchema,
  sessionId: z.string().trim().min(1).max(100),
  messageId: z.string().trim().min(1).max(200),
})

/**
 * Removes the caller's question and every later message in that conversation,
 * so the question can be asked again. A link already shared is a copy and stays.
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const { chatbotId, sessionId, messageId } = bodySchema.parse(await req.json())
    await requireChatbotAccess(supabase, user.id, chatbotId, "member")

    const { data, error } = await supabase.rpc("truncate_chat_from", {
      p_chatbot_id: chatbotId,
      p_session_id: sessionId,
      p_message_id: messageId,
    })
    if (error) throw error
    const deleted = Number(data)
    if (!Number.isFinite(deleted) || deleted < 1) {
      throw new HttpError(404, "No se encontró esa pregunta.")
    }
    return NextResponse.json({ deleted })
  } catch (error) {
    return errorResponse(error, "POST /api/history/rewind")
  }
}

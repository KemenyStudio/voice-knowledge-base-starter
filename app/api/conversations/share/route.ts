import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { getSessionTranscript } from "@/lib/conversations"
import { HttpError, errorResponse } from "@/lib/http"
import { requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  chatbotId: uuidSchema,
  sessionId: z.string().min(1).max(100),
})

/**
 * Freezes the signed-in user's conversation into a link that other members of
 * the same team can open (sign-in and team membership are required to read it).
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const { chatbotId, sessionId } = bodySchema.parse(await req.json())
    await requireChatbotAccess(supabase, user.id, chatbotId, "member")

    const transcript = await getSessionTranscript(
      supabase,
      user.id,
      sessionId,
      chatbotId
    )
    if (transcript.length === 0) {
      throw new HttpError(404, "There is nothing to share in this conversation")
    }

    const title =
      transcript.find((m) => m.role === "user")?.content.slice(0, 120) ?? null
    const messages = transcript.map((m) => ({
      role: m.role,
      content: m.content,
      citations: m.citations.map((c) => ({
        number: c.number,
        title: c.title,
        text: c.text.slice(0, 600),
        url: c.file_url,
      })),
    }))

    const { data, error } = await supabase
      .from("conversation_shares")
      .insert({ user_id: user.id, chatbot_id: chatbotId, title, messages })
      .select("id")
      .single()
    if (error) throw error

    return NextResponse.json({ id: data.id, path: `/shared/${data.id}` })
  } catch (error) {
    return errorResponse(error, "POST /api/conversations/share")
  }
}

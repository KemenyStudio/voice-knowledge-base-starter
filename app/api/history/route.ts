import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { getSessionTranscript } from "@/lib/conversations"
import { errorResponse } from "@/lib/http"
import { requireUser } from "@/lib/supabase/server"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  chatbotId: uuidSchema,
  sessionId: z.string().min(1).max(100),
})

/** Transcript of one of the signed-in user's conversations. */
export const POST = async (req: NextRequest) => {
  try {
    const { supabase, user } = await requireUser()
    const { chatbotId, sessionId } = bodySchema.parse(await req.json())
    await requireChatbotAccess(supabase, user.id, chatbotId, "member")

    const messages = await getSessionTranscript(
      supabase,
      user.id,
      sessionId,
      chatbotId
    )
    return NextResponse.json(messages, { status: 200 })
  } catch (error) {
    return errorResponse(error, "POST /api/history")
  }
}

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import {
  INSTRUCTIONS_MAX_LENGTH,
  TOOLS,
  RUNNABLE_TOOL_IDS,
  normalizeTools,
} from "@/lib/tools/registry"
import { runTool } from "@/lib/tools/run"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const maxDuration = 120
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  chatbotId: uuidSchema,
  tool: z.enum(RUNNABLE_TOOL_IDS),
  messageId: z.string().min(1).max(200).optional(),
  fileId: uuidSchema.optional(),
  instructions: z.string().max(INSTRUCTIONS_MAX_LENGTH * 2).optional(),
})

/** Tools this assistant offers. */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = uuidSchema.parse(req.nextUrl.searchParams.get("chatbotId"))
    const { chatbot } = await requireChatbotAccess(supabase, user.id, chatbotId, "member")
    return NextResponse.json({
      tools: normalizeTools(chatbot.enabled_tools).map((id) => TOOLS[id]),
    })
  } catch (error) {
    return errorResponse(error, "GET /api/tools")
  }
}

/**
 * Runs one tool for a member: a text drafted from one of their own answers, or
 * a validity check of a document of the assistant. Returns { tool, text }.
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = bodySchema.parse(await req.json())
    const { chatbot } = await requireChatbotAccess(supabase, user.id, body.chatbotId, "member")
    const result = await runTool(
      { supabase, admin: getAdminClient(), userId: user.id, chatbot },
      body
    )
    return NextResponse.json(result)
  } catch (error) {
    return errorResponse(error, "POST /api/tools")
  }
}

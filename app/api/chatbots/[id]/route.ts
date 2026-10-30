import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { normalizeOptions } from "@/lib/audience"
import { MAX_PROMPT_NOTES } from "@/lib/prompt-notes"
import { requireChatbotAccess, parseUuid } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import { getKnowledgeOverview } from "@/lib/knowledge/overview"
import { TOOL_IDS, TOOLS, normalizeTools } from "@/lib/tools/registry"
import { requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const suggestedQuestionsSchema = z
  .array(
    z.object({
      category: z.string().trim().min(1).max(80),
      prompts: z.array(z.string().trim().min(1).max(300)).min(1).max(12),
    })
  )
  .max(6)

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(500),
    welcome_message: z.string().trim().max(600).nullable(),
    suggested_questions: suggestedQuestionsSchema,
    audience_options: z.array(z.string()).max(20),
    audience_filter: z.boolean(),
    prompt_notes: z.array(z.string().trim().min(1).max(300)).max(MAX_PROMPT_NOTES),
    research_enabled: z.boolean(),
    enabled_tools: z.array(z.enum(TOOL_IDS)).max(TOOL_IDS.length),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update")

/** Settings of one assistant that members may read. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { supabase, user } = await requireUser()
    const { chatbot, role } = await requireChatbotAccess(
      supabase,
      user.id,
      parseUuid(params.id),
      "member"
    )
    const knowledge = await getKnowledgeOverview(supabase, chatbot.id).catch(
      () => null
    )
    return NextResponse.json({
      id: chatbot.id,
      name: chatbot.name,
      description: chatbot.description,
      welcome_message: chatbot.welcome_message,
      suggested_questions: chatbot.suggested_questions ?? [],
      audience_options: chatbot.audience_options ?? [],
      audience_filter: chatbot.audience_filter ?? false,
      prompt_notes: chatbot.prompt_notes ?? [],
      research_enabled: chatbot.research_enabled ?? true,
      tools: normalizeTools(chatbot.enabled_tools).map((id) => TOOLS[id]),
      knowledge,
      role,
    })
  } catch (error) {
    return errorResponse(error, "GET /api/chatbots/[id]")
  }
}

/** Updates the texts of an assistant. Team admins only. */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = parseUuid(params.id)
    await requireChatbotAccess(supabase, user.id, chatbotId, "admin")
    const { audience_options, enabled_tools, ...rest } = patchSchema.parse(await req.json())
    const patch = {
      ...rest,
      ...(enabled_tools ? { enabled_tools: Array.from(new Set(enabled_tools)) } : {}),
      ...(audience_options ? { audience_options: normalizeOptions(audience_options) } : {}),
    }

    const { data, error } = await supabase
      .from("chatbots")
      .update(patch)
      .eq("id", chatbotId)
      .select(
        "id, name, description, welcome_message, suggested_questions, audience_options, audience_filter, prompt_notes, research_enabled, enabled_tools"
      )
      .single()
    if (error) throw error
    return NextResponse.json(data)
  } catch (error) {
    return errorResponse(error, "PATCH /api/chatbots/[id]")
  }
}

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { findOption } from "@/lib/audience"
import { parseUuid, requireChatbotAccess } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { getPrefs, savePrefs, type AssistantPrefs } from "@/lib/preferences"
import { parseVoiceLength, parseVoiceNavigation } from "@/lib/voice/call-settings"
import { requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const putSchema = z
  .object({
    entity_type: z.string().trim().max(80).nullable(),
    entity_prompt_dismissed: z.boolean(),
    email_alerts: z.boolean(),
    length: z.enum(["breve", "normal", "detallada"]),
    navigation: z.enum(["app", "library"]),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, "Nothing to update")

/** What this assistant remembers about the signed-in user. */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { supabase, user } = await requireUser()
    const { chatbot } = await requireChatbotAccess(
      supabase,
      user.id,
      parseUuid(params.id),
      "member"
    )
    const options = chatbot.audience_options ?? []
    const prefs = await getPrefs(supabase, user.id, chatbot.id, options)
    return NextResponse.json({ ...prefs, options })
  } catch (error) {
    return errorResponse(error, "GET /api/chatbots/[id]/preferences")
  }
}

/** Saves the user's entity type (must be one of the assistant's options, or null to forget it). */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { supabase, user } = await requireUser()
    const { chatbot } = await requireChatbotAccess(
      supabase,
      user.id,
      parseUuid(params.id),
      "member"
    )
    const body = putSchema.parse(await req.json())
    const options = chatbot.audience_options ?? []

    const patch: Partial<AssistantPrefs> = {}
    if (body.entity_type !== undefined) {
      if (body.entity_type === null) {
        patch.entity_type = null
      } else {
        const option = findOption(options, body.entity_type)
        if (!option) throw new HttpError(400, "Unknown entity type")
        patch.entity_type = option
        patch.entity_prompt_dismissed = true
      }
    }
    if (body.entity_prompt_dismissed !== undefined) {
      patch.entity_prompt_dismissed = body.entity_prompt_dismissed
    }

    if (body.email_alerts !== undefined) patch.email_alerts = body.email_alerts
    if (body.length !== undefined) patch.length = parseVoiceLength(body.length)
    if (body.navigation !== undefined) patch.navigation = parseVoiceNavigation(body.navigation)

    await savePrefs(supabase, user.id, chatbot.id, patch)
    const prefs = await getPrefs(supabase, user.id, chatbot.id, options)
    return NextResponse.json({ ...prefs, options })
  } catch (error) {
    return errorResponse(error, "PUT /api/chatbots/[id]/preferences")
  }
}

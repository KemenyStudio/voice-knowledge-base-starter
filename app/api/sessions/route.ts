import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import {
  cleanSessionTitle,
  deleteSession,
  listSessions,
  renameSession,
  searchSessions,
} from "@/lib/conversations"
import { HttpError, errorResponse } from "@/lib/http"
import { requireUser } from "@/lib/supabase/server"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const sessionSchema = z.object({
  chatbotId: uuidSchema,
  sessionId: z.string().trim().min(1).max(100),
})

/** Conversations of the signed-in user. Pass `query` (2+ characters) to search older ones too. */
export const POST = async (req: NextRequest) => {
  try {
    const { supabase, user } = await requireUser()
    const body = z
      .object({
        chatbotId: uuidSchema,
        query: z.string().trim().max(200).optional(),
      })
      .parse(await req.json())
    await requireChatbotAccess(supabase, user.id, body.chatbotId, "member")

    const query = body.query?.trim() ?? ""
    if (query.length === 1) {
      throw new HttpError(400, "Escribe al menos 2 caracteres para buscar.")
    }
    const sessions = query
      ? await searchSessions(supabase, body.chatbotId, query)
      : await listSessions(supabase, body.chatbotId)
    return NextResponse.json(sessions, { status: 200 })
  } catch (error) {
    return errorResponse(error, "POST /api/sessions")
  }
}

/** Renames one of the signed-in user's conversations. */
export const PATCH = async (req: NextRequest) => {
  try {
    const { supabase, user } = await requireUser()
    const body = sessionSchema
      .extend({ title: z.string().max(200) })
      .parse(await req.json())
    await requireChatbotAccess(supabase, user.id, body.chatbotId, "member")

    const title = cleanSessionTitle(body.title)
    if (!title) {
      throw new HttpError(400, "El título debe tener entre 1 y 120 caracteres.")
    }
    const updated = await renameSession(
      supabase,
      body.chatbotId,
      body.sessionId,
      title
    )
    if (updated === 0) throw new HttpError(404, "Conversación no encontrada")
    return NextResponse.json({ title, updated })
  } catch (error) {
    return errorResponse(error, "PATCH /api/sessions")
  }
}

/** Deletes one of the signed-in user's conversations. A link already shared stays available. */
export const DELETE = async (req: NextRequest) => {
  try {
    const { supabase, user } = await requireUser()
    const url = new URL(req.url)
    const fromQuery = {
      chatbotId: url.searchParams.get("chatbotId") ?? undefined,
      sessionId: url.searchParams.get("sessionId") ?? undefined,
    }
    const payload =
      fromQuery.chatbotId && fromQuery.sessionId
        ? fromQuery
        : await req.json().catch(() => ({}))
    const body = sessionSchema.parse(payload)
    await requireChatbotAccess(supabase, user.id, body.chatbotId, "member")

    const deleted = await deleteSession(
      supabase,
      user.id,
      body.chatbotId,
      body.sessionId
    )
    if (deleted === 0) throw new HttpError(404, "Conversación no encontrada")
    return NextResponse.json({ deleted })
  } catch (error) {
    return errorResponse(error, "DELETE /api/sessions")
  }
}

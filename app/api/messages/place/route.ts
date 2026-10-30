import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  chatbotId: uuidSchema,
  messageId: z.string().trim().min(1).max(200),
  pinned: z.boolean().optional(),
  setFolder: z.boolean().optional(),
  folder: z.string().max(40).nullable().optional(),
})

/** Pins a message or moves it into a folder inside the caller's conversation. */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = bodySchema.parse(await req.json())
    if (body.pinned === undefined && !body.setFolder) {
      throw new HttpError(400, "Indica si fijas el mensaje o a qué carpeta va.")
    }
    await requireChatbotAccess(supabase, user.id, body.chatbotId, "member")

    const { data, error } = await supabase.rpc("set_message_place", {
      p_chatbot_id: body.chatbotId,
      p_message_id: body.messageId,
      p_pinned: body.pinned ?? null,
      p_set_folder: Boolean(body.setFolder),
      p_folder: body.folder ?? null,
    })
    if (error) {
      if ((error.message ?? "").includes("invalid folder")) {
        throw new HttpError(400, "El nombre de la carpeta debe tener entre 1 y 40 caracteres.")
      }
      throw error
    }
    if (Number(data) < 1) {
      throw new HttpError(404, "No se encontró ese mensaje.")
    }
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, "POST /api/messages/place")
  }
}

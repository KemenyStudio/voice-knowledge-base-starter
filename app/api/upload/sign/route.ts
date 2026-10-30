import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import {
  ALLOWED_EXTENSIONS_LABEL,
  MAX_UPLOAD_BYTES,
  isAllowedExtension,
} from "@/lib/knowledge/metadata"
import { buildStoragePath, createUploadTarget } from "@/lib/storage"
import { requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  size: z.number().int().positive(),
  chatbotId: uuidSchema,
})

/**
 * Step 1 of an upload (team admins only): validates the file and returns a
 * one-time signed URL so the browser can send the bytes straight to Supabase
 * Storage. This keeps large files out of the serverless request body (about
 * 4.5 MB on Vercel). Step 2 is POST /api/upload, which indexes the object.
 */
export const POST = async (req: NextRequest) => {
  try {
    const { supabase, user } = await requireUser()
    const body = bodySchema.parse(await req.json())

    const { chatbot } = await requireChatbotAccess(
      supabase,
      user.id,
      body.chatbotId,
      "admin"
    )

    if (!isAllowedExtension(body.fileName)) {
      throw new HttpError(
        415,
        `Unsupported file type. Allowed: ${ALLOWED_EXTENSIONS_LABEL}`
      )
    }
    if (body.size > MAX_UPLOAD_BYTES) {
      throw new HttpError(
        413,
        `The file exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`
      )
    }

    const path = buildStoragePath(chatbot.team_id, chatbot.id, body.fileName)
    const target = await createUploadTarget(path)

    return NextResponse.json({ ...target, maxBytes: MAX_UPLOAD_BYTES })
  } catch (error) {
    return errorResponse(error, "POST /api/upload/sign")
  }
}

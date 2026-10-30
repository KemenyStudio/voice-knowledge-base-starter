import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { commitLibraryUpload } from "@/lib/knowledge/commit-upload"
import {
  ALLOWED_EXTENSIONS_LABEL,
  MAX_UPLOAD_BYTES,
  isAllowedExtension,
  metadataSchema,
} from "@/lib/knowledge/metadata"
import {
  deleteObject,
  downloadObject,
  isChatbotStoragePath,
} from "@/lib/storage"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const maxDuration = 300
export const dynamic = "force-dynamic"

const bodySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  /** Object already uploaded through the URL from POST /api/upload/sign. */
  storagePath: z.string().min(1).max(500),
  chatbotId: uuidSchema,
  metadata: metadataSchema,
  /** Filter audience confirmed in the upload dialog. Omit to leave it unset. */
  audience: z.array(z.string().trim().max(80)).max(8).optional(),
})

/**
 * Step 2 of an upload (team admins only). The browser has already sent the
 * file to private Supabase Storage using the URL from POST /api/upload/sign;
 * this records it in Supabase and indexes it in the chatbot's own OpenAI
 * vector store.
 */
export const POST = async (req: NextRequest) => {
  let storagePath: string | null = null
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
    if (!isChatbotStoragePath(body.storagePath, chatbot.team_id, chatbot.id)) {
      throw new HttpError(400, "Invalid storage path for this assistant")
    }
    storagePath = body.storagePath

    const { data: existing } = await supabase
      .from("files")
      .select("id")
      .eq("blob_name", storagePath)
      .maybeSingle()
    if (existing) {
      storagePath = null // belongs to another record; never delete it
      throw new HttpError(409, "This upload was already registered")
    }

    let buffer: Buffer
    try {
      buffer = await downloadObject(storagePath)
    } catch {
      storagePath = null
      throw new HttpError(400, "The file was not found in storage. Upload it first.")
    }
    if (buffer.length === 0) throw new HttpError(400, "The file is empty")
    if (buffer.length > MAX_UPLOAD_BYTES) {
      throw new HttpError(
        413,
        `The file exceeds the ${Math.round(MAX_UPLOAD_BYTES / 1024 / 1024)} MB limit`
      )
    }
    const result = await commitLibraryUpload({
      supabase,
      admin: getAdminClient(),
      userId: user.id,
      chatbot,
      fileName: body.fileName,
      buffer,
      metadata: body.metadata,
      storagePath,
      ...(body.audience !== undefined ? { audience: body.audience } : {}),
    })
    storagePath = null

    return NextResponse.json(
      {
        suggestions: result.suggestions,
        message:
          result.file.sync_status === "failed"
            ? "The document was saved but could not be indexed. You can retry from the library."
            : "Upload successful",
        file: result.file,
      },
      { status: 200 }
    )
  } catch (error) {
    // The object was uploaded but never became a record: don't leave it orphaned.
    if (storagePath) await deleteObject(storagePath).catch(() => undefined)
    return errorResponse(error, "POST /api/upload")
  }
}

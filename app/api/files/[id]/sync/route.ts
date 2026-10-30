import { NextRequest, NextResponse } from "next/server"

import { parseUuid, requireFileAccess } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { syncFileRow } from "@/lib/knowledge/vector-store"
import { downloadObject } from "@/lib/storage"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const maxDuration = 300
export const dynamic = "force-dynamic"

/**
 * (Re)indexes a document from its stored original. Used to retry a failed
 * upload and to bring legacy documents into the chatbot's own vector store
 * (team admins only).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { supabase, user } = await requireUser()
    const { file, chatbot } = await requireFileAccess(
      supabase,
      user.id,
      parseUuid(params.id),
      "admin"
    )

    if (!file.blob_name) {
      throw new HttpError(
        404,
        "The original document is not in storage yet. Run scripts/migrate-blobs-to-supabase.mjs for legacy documents."
      )
    }

    let buffer: Buffer
    try {
      buffer = await downloadObject(file.blob_name)
    } catch (err) {
      console.error("[POST /api/files/:id/sync] download", err)
      throw new HttpError(404, "The original document could not be read from storage")
    }

    const updated = await syncFileRow({
      admin: getAdminClient(),
      file,
      chatbot,
      buffer,
    })
    return NextResponse.json({ file: updated })
  } catch (error) {
    return errorResponse(error, "POST /api/files/:id/sync")
  }
}

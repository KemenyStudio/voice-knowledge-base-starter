import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { getAdminClient, requireUser } from "@/lib/supabase/server"
import { ingestProposal, releaseStaleClaims, type IngestRow } from "@/lib/watch/ingest"
import { isAlreadyInLibrary } from "@/lib/watch/library-match"

export const maxDuration = 300
export const dynamic = "force-dynamic"

/**
 * Adds one proposed official file to this assistant's library.
 * Used after the in-page preview was able to fetch the file.
 * Does not replace a document that is already there.
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = z
      .object({ chatbotId: uuidSchema, id: uuidSchema })
      .parse(await req.json())
    const { chatbot } = await requireChatbotAccess(
      supabase,
      user.id,
      body.chatbotId,
      "admin"
    )
    const admin = getAdminClient()
    await releaseStaleClaims(admin, chatbot.id)

    const { data, error } = await admin
      .from("source_proposals")
      .select("id, source, external_id, title, url, organ, status")
      .eq("id", body.id)
      .eq("chatbot_id", chatbot.id)
      .maybeSingle()
    if (error) throw error
    const row = data as (IngestRow & { status: string }) | null
    if (!row || row.status === "dismissed") {
      throw new HttpError(404, "No se encontró ese documento.")
    }
    if (row.status === "ingested") {
      return NextResponse.json({ status: "already" })
    }
    if (row.status !== "proposed") {
      throw new HttpError(409, "Ese documento ya se está agregando.")
    }

    const { data: files, error: filesError } = await admin
      .from("files")
      .select("file_name")
      .eq("chatbot_id", chatbot.id)
    if (filesError) throw filesError
    const names = (files ?? []).map((file) => file.file_name as string)
    if (isAlreadyInLibrary(row.title, names)) {
      return NextResponse.json({ status: "already" })
    }

    const outcome = await ingestProposal(
      { supabase, admin, userId: user.id, chatbot },
      row,
      names
    )
    switch (outcome.status) {
      case "ingested":
        return NextResponse.json({
          status: "ingested",
          file: { id: outcome.file.id, file_name: outcome.file.file_name },
        })
      case "already":
        return NextResponse.json({ status: "already" })
      case "missing":
        throw new HttpError(409, "Ese documento ya se está agregando.")
      case "failed":
        throw new HttpError(422, "No se pudo obtener el archivo oficial.")
      default: {
        const unknown: never = outcome
        return unknown
      }
    }
  } catch (error) {
    return errorResponse(error, "POST /api/watch/ingest")
  }
}

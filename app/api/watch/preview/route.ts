import { NextRequest, NextResponse } from "next/server"

import { parseUuid, requireChatbotAccess } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { getAdminClient, requireUser } from "@/lib/supabase/server"
import { fetchOfficialDocument, type OfficialDocument } from "@/lib/watch/official-file"
import type { SourceId } from "@/lib/watch/sources"

export const maxDuration = 60
export const dynamic = "force-dynamic"

interface PreviewRow {
  id: string
  source: string
  external_id: string
  title: string
  url: string
  status: string
  file_id: string | null
}

function contentDispositionInline(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "")
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function inlineResponse(doc: OfficialDocument): NextResponse {
  const headers: Record<string, string> = {
    "Content-Type": doc.contentType,
    "Content-Disposition": contentDispositionInline(doc.fileName),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  }
  if (doc.contentType.startsWith("text/html")) {
    headers["Content-Security-Policy"] = "sandbox"
  }
  return new NextResponse(new Uint8Array(doc.bytes), { headers })
}

/**
 * Fetches one proposal's official file for an in-page preview.
 * Returns JSON when the file is already in the library, or when it was fetched
 * but the browser would download it instead of showing it.
 */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = parseUuid(req.nextUrl.searchParams.get("chatbotId"))
    const id = parseUuid(req.nextUrl.searchParams.get("id"))
    await requireChatbotAccess(supabase, user.id, chatbotId, "admin")

    const { data, error } = await getAdminClient()
      .from("source_proposals")
      .select("id, source, external_id, title, url, status, file_id")
      .eq("id", id)
      .eq("chatbot_id", chatbotId)
      .maybeSingle()
    if (error) throw error
    const row = data as PreviewRow | null
    if (!row || row.status === "dismissed") {
      throw new HttpError(404, "No se encontró ese documento.")
    }
    if (row.file_id) {
      return NextResponse.json({ fileId: row.file_id, title: row.title })
    }

    const doc = await fetchOfficialDocument({
      source: row.source as SourceId,
      externalId: row.external_id,
      url: row.url,
      title: row.title,
    })
    if (!doc) {
      throw new HttpError(422, "No se pudo obtener el archivo oficial.")
    }
    if (!doc.previewInline) {
      return NextResponse.json({
        ok: true,
        previewInline: false,
        title: row.title,
      })
    }
    return inlineResponse(doc)
  } catch (error) {
    return errorResponse(error, "GET /api/watch/preview")
  }
}

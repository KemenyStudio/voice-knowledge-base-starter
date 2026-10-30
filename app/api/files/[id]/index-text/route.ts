import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { parseUuid, requireFileAccess } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { extractPdfIndexText } from "@/lib/knowledge/extract-text"
import {
  healthForIndexedText,
  normalizeIndexText,
  shouldReplaceIndex,
} from "@/lib/knowledge/index-text"
import { extensionFor } from "@/lib/knowledge/index-readiness"
import { replaceIndexWithText } from "@/lib/knowledge/vector-store"
import { downloadObject } from "@/lib/storage"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const maxDuration = 300
export const dynamic = "force-dynamic"

const bodySchema = z
  .object({
    /** OCR (or other) text used only when the stored file still has none. */
    text: z.string().max(4_000_000).optional(),
    pages: z.number().int().positive().max(5000).optional(),
  })
  .optional()

/**
 * Admin-only. Re-reads the stored original, and when that yields searchable
 * text, replaces the vector-store file with that text and recomputes
 * index_health. The library row and the stored original stay.
 * A scanned PDF can send OCR text; it is ignored when the file already has text.
 */
export async function POST(
  req: NextRequest,
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
    const body = bodySchema.parse(await req.json().catch(() => ({})))

    let extracted = ""
    let pages: number | null = null
    if (file.blob_name && extensionFor(file.file_name, file.file_type) === "pdf") {
      try {
        const buffer = await downloadObject(file.blob_name)
        const result = await extractPdfIndexText(buffer)
        extracted = result.text
        pages = result.pages
      } catch (error) {
        console.error("[POST /api/files/:id/index-text] download", file.id, error)
        throw new HttpError(404, "The original document could not be read from storage")
      }
    }

    const native = normalizeIndexText(extracted)
    const supplied = normalizeIndexText(body?.text ?? "")
    const useNative = native.length >= 40
    const text = useNative ? extracted.trim() : (body?.text ?? "").trim()
    const pageCount = useNative ? pages : (body?.pages ?? pages)
    const health = healthForIndexedText({
      sizeBytes: file.size_bytes ?? Buffer.byteLength(text, "utf8"),
      fileType: file.file_type,
      text,
      pages: pageCount,
    })
    const previousScore = file.index_health_score

    if (!shouldReplaceIndex(previousScore, health, text)) {
      return NextResponse.json({
        replaced: false,
        skipped: true,
        reason: normalizeIndexText(text).length < 40 ? "no_text" : "score_not_higher",
        previousScore,
        score: health.score,
        chars: Math.max(native.length, supplied.length),
      })
    }

    const indexed = `Documento: ${file.file_name}\n\n${text}`
    const result = await replaceIndexWithText({
      admin: getAdminClient(),
      file,
      chatbot,
      text: indexed,
      health,
    })
    if (!result.replaced) {
      throw new HttpError(502, result.error ?? "The index file could not be replaced")
    }

    return NextResponse.json({
      replaced: true,
      skipped: false,
      previousScore,
      score: result.file.index_health_score,
      syncStatus: result.file.sync_status,
      chars: normalizeIndexText(text).length,
    })
  } catch (error) {
    return errorResponse(error, "POST /api/files/:id/index-text")
  }
}

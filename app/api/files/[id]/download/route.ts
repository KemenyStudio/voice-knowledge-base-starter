import { NextRequest, NextResponse } from "next/server"

import { parseUuid, requireFileAccess } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { createReadUrl, downloadObject } from "@/lib/storage"
import { requireUser } from "@/lib/supabase/server"
import type { FileRow } from "@/types/knowledge"

export const dynamic = "force-dynamic"
export const maxDuration = 60

const PREVIEW_MIME: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain; charset=utf-8",
  md: "text/plain; charset=utf-8",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  json: "application/json",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
}

/** MIME type when the browser can show the file inside the page. */
function previewMime(file: Pick<FileRow, "file_name" | "file_type">): string | null {
  const raw = (file.file_type ?? "").trim().toLowerCase()
  const extension = file.file_name.split(".").pop()?.toLowerCase() ?? ""
  if (raw === "application/pdf" || raw.startsWith("image/") || raw.startsWith("text/")) {
    return raw
  }
  const token = raw.replace(/^\./, "")
  return PREVIEW_MIME[token] ?? PREVIEW_MIME[extension] ?? null
}

function contentDispositionInline(name: string): string {
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/"/g, "")
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function unsupportedPreviewHtml(name: string): string {
  const safe = name
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
  return `<!doctype html><html lang="es"><meta charset="utf-8"><title>${safe}</title><body style="font-family:system-ui,sans-serif;padding:24px;color:#333"><p>No se puede mostrar <strong>${safe}</strong> dentro de la página.</p><p>El fragmento citado sigue en la tarjeta de la fuente.</p></body></html>`
}

async function fileBytes(file: FileRow): Promise<Buffer> {
  if (file.blob_name) return downloadObject(file.blob_name)
  if (/^https?:\/\//i.test(file.file_url)) {
    const response = await fetch(file.file_url)
    if (!response.ok) throw new HttpError(404, "The original document is not available")
    return Buffer.from(await response.arrayBuffer())
  }
  throw new HttpError(404, "The original document is not available")
}

/** Serves the file for an in-page iframe. Does not redirect. */
async function inlinePreview(file: FileRow): Promise<NextResponse> {
  const mime = previewMime(file)
  if (!mime) {
    return new NextResponse(unsupportedPreviewHtml(file.file_name), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox",
      },
    })
  }
  const bytes = await fileBytes(file)
  const headers: Record<string, string> = {
    "Content-Type": mime,
    "Content-Disposition": contentDispositionInline(file.file_name),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  }
  // Uploaded HTML must not run as this origin.
  if (mime.startsWith("text/html")) headers["Content-Security-Policy"] = "sandbox"
  return new NextResponse(new Uint8Array(bytes), { headers })
}

/**
 * Redirects to a short-lived signed URL of the original document.
 * `?inline=1` returns the bytes for an in-page preview instead.
 * Only members of the chatbot's team can obtain it.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { supabase, user } = await requireUser()
    const { file } = await requireFileAccess(
      supabase,
      user.id,
      parseUuid(params.id),
      "member"
    )

    if (req.nextUrl.searchParams.get("inline") === "1") {
      return inlinePreview(file)
    }

    let url: string
    if (file.blob_name) {
      url = await createReadUrl(file.blob_name)
    } else if (/^https?:\/\//i.test(file.file_url)) {
      // Legacy document not yet copied to Supabase Storage
      // (scripts/migrate-blobs-to-supabase.mjs): keep its old link working.
      const { origin, pathname } = new URL(file.file_url)
      url = origin + pathname.split("/").map(encodeURIComponent).join("/")
    } else {
      throw new HttpError(404, "The original document is not available")
    }

    return NextResponse.redirect(url, {
      status: 302,
      headers: { "Cache-Control": "private, no-store" },
    })
  } catch (error) {
    return errorResponse(error, "GET /api/files/:id/download")
  }
}

import { strFromU8, unzipSync } from "fflate"
import { getDocumentProxy } from "unpdf"

import { extensionFor } from "@/lib/knowledge/index-readiness"

const EXCERPT_CHARS = 12_000

function visibleText(raw: string, html: boolean): string {
  const withoutMarkup = html
    ? raw
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    : raw
  return withoutMarkup
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim()
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

function clip(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, EXCERPT_CHARS)
}

function pageNumbers(total: number): number[] {
  const picks = new Set<number>()
  const head = Math.min(total, 8)
  for (let page = 1; page <= head; page += 1) picks.add(page)
  if (total > 8) picks.add(total)
  if (total > 10) picks.add(Math.ceil(total / 2))
  return Array.from(picks).sort((a, b) => a - b)
}

async function pageText(
  pdf: Awaited<ReturnType<typeof getDocumentProxy>>,
  pageNumber: number
): Promise<string> {
  const page = await pdf.getPage(pageNumber)
  try {
    const content = await page.getTextContent()
    return content.items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
  } finally {
    page.cleanup()
  }
}

async function pdfExcerpt(bytes: Uint8Array): Promise<string> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null
  try {
    pdf = await getDocumentProxy(bytes.slice())
    const parts: string[] = []
    for (const pageNumber of pageNumbers(pdf.numPages)) {
      const text = await pageText(pdf, pageNumber)
      if (text) parts.push(text)
      if (parts.join(" ").length >= EXCERPT_CHARS) break
    }
    return clip(parts.join("\n"))
  } catch {
    return ""
  } finally {
    const destroy = pdf && "destroy" in pdf ? pdf.destroy : undefined
    if (typeof destroy === "function") await destroy.call(pdf)
  }
}

const INDEX_TEXT_MAX = 4_000_000

/** Full text for the search index, with a page marker on every page that has text. */
export async function extractPdfIndexText(
  bytes: Uint8Array
): Promise<{ text: string; pages: number | null }> {
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null
  try {
    pdf = await getDocumentProxy(bytes.slice())
    const parts: string[] = []
    let used = 0
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const text = await pageText(pdf, pageNumber)
      if (!text) continue
      const block = `--- página ${pageNumber} ---\n${text}`
      parts.push(block)
      used += block.length + 2
      if (used >= INDEX_TEXT_MAX) break
    }
    return { text: parts.join("\n\n").slice(0, INDEX_TEXT_MAX), pages: pdf.numPages }
  } catch {
    return { text: "", pages: null }
  } finally {
    const destroy = pdf && "destroy" in pdf ? pdf.destroy : undefined
    if (typeof destroy === "function") await destroy.call(pdf)
  }
}

function officeExcerpt(bytes: Uint8Array, slides: boolean): string {
  if (!isZip(bytes)) return ""
  try {
    const entries = unzipSync(bytes)
    const parts: string[] = []
    for (const [path, data] of Object.entries(entries)) {
      const wanted = slides
        ? path.startsWith("ppt/slides/slide") && path.endsWith(".xml")
        : path === "word/document.xml"
      if (!wanted) continue
      parts.push(visibleText(strFromU8(data), true))
    }
    return clip(parts.join(" "))
  } catch {
    return ""
  }
}

/**
 * Text Astra can read from a file the admin selected or one already stored.
 * Returns an excerpt, not the whole file. Empty when the bytes have no text.
 */
export async function extractDocumentExcerpt(
  fileName: string,
  bytes: Uint8Array,
  fileType?: string | null
): Promise<string> {
  const extension = extensionFor(fileName, fileType)
  if (bytes.byteLength === 0) return ""
  if (extension === "pdf") return pdfExcerpt(bytes)
  if (extension === "docx") return officeExcerpt(bytes, false)
  if (extension === "pptx") return officeExcerpt(bytes, true)
  if (extension === "txt" || extension === "md" || extension === "html" || extension === "json") {
    const raw = new TextDecoder("utf-8", { fatal: false }).decode(bytes)
    return clip(visibleText(raw, extension === "html"))
  }
  return ""
}

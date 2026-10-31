import { strFromU8, unzipSync } from "fflate"
import { getDocumentProxy, getResolvedPDFJS } from "unpdf"

import { getExtension, MAX_UPLOAD_BYTES } from "@/lib/knowledge/metadata"

/** Above this size the file still uploads, but search quality usually drops. */
export const HUGE_FILE_BYTES = 10 * 1024 * 1024

const EMPTY_TEXT_CHARS = 40
const THIN_TEXT_CHARS = 400
const MANY_PAGES = 250

export type IndexVerdict = "good" | "review" | "unknown"

/** What we store on the file and show before upload. */
export interface IndexHealth {
  score: number | null
  verdict: IndexVerdict
  reasons: string[]
  /**
   * False only when the server would reject the file (empty or over the
   * upload limit). Quality warnings still allow the upload.
   */
  canUpload: boolean
}

export interface IndexFacts {
  sizeBytes: number
  kind: "pdf" | "docx" | "pptx" | "text" | "doc" | "other"
  textChars: number
  pages: number | null
  /** Share of sampled pages that are images with almost no text. 0–1. */
  scanRatio: number
  passwordProtected: boolean
  extractable: boolean
}

export function scoreIndexHealth(facts: IndexFacts): IndexHealth {
  if (facts.sizeBytes <= 0) {
    return {
      score: 0,
      verdict: "review",
      reasons: ["El archivo está vacío."],
      canUpload: false,
    }
  }

  if (facts.sizeBytes > MAX_UPLOAD_BYTES) {
    const maxMb = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))
    return {
      score: 5,
      verdict: "review",
      reasons: [`Supera el máximo de ${maxMb} MB. Hay que reducirlo antes de subirlo.`],
      canUpload: false,
    }
  }

  if (facts.passwordProtected) {
    return {
      score: 15,
      verdict: "review",
      reasons: [
        "Está protegido con contraseña. El índice no puede leer el texto hasta quitarla.",
      ],
      canUpload: true,
    }
  }

  const reasons: string[] = []
  let score = 100
  const likelyScan = facts.kind === "pdf" && facts.scanRatio >= 0.6

  if (!facts.extractable) {
    reasons.push(
      facts.kind === "doc"
        ? "Este Word antiguo (.doc) no deja extraer el texto con fiabilidad. Guárdalo como .docx o como PDF con texto."
        : "No pudimos extraer texto de este archivo."
    )
    score = Math.min(score, 35)
  } else if (facts.textChars < EMPTY_TEXT_CHARS) {
    reasons.push(
      likelyScan
        ? "El PDF parece un escaneo: tiene imágenes y casi ningún texto seleccionable. Conviene aplicar OCR antes de subirlo."
        : "No tiene texto que el índice pueda buscar."
    )
    score = Math.min(score, likelyScan ? 25 : 20)
  } else if (likelyScan) {
    reasons.push(
      "Gran parte del PDF parece escaneada. El texto seleccionable no alcanza para una buena búsqueda."
    )
    score = Math.min(score, 40)
  } else if (facts.textChars < THIN_TEXT_CHARS) {
    reasons.push(
      "El texto extraído es muy corto. Revisa que no sea solo una portada o un archivo incompleto."
    )
    score = Math.min(score, 60)
  }

  if (facts.sizeBytes > HUGE_FILE_BYTES) {
    const mb = Math.max(1, Math.round(facts.sizeBytes / (1024 * 1024)))
    reasons.push(`Pesa ${mb} MB. Un archivo de menos de 10 MB se indexa mejor.`)
    score -= 25
  }

  if (facts.pages != null && facts.pages > MANY_PAGES) {
    reasons.push(
      `Tiene ${facts.pages} páginas. Dividirlo en partes ayuda a que la búsqueda encuentre el pasaje correcto.`
    )
    score -= 15
  }

  score = Math.max(0, Math.min(100, Math.round(score)))
  return {
    score,
    verdict: reasons.length === 0 ? "good" : "review",
    reasons,
    canUpload: true,
  }
}

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

function isOle(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  )
}

function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

function samplePageNumbers(total: number): number[] {
  if (total <= 10) return Array.from({ length: total }, (_, index) => index + 1)
  const picks = new Set<number>([1, 2, total])
  const step = total / 8
  for (let index = 1; index <= 8; index += 1) {
    picks.add(Math.min(total, Math.max(1, Math.round(index * step))))
  }
  return Array.from(picks).sort((a, b) => a - b)
}

async function inspectPdf(bytes: Uint8Array, sizeBytes: number): Promise<IndexFacts> {
  const base = {
    sizeBytes,
    kind: "pdf" as const,
    textChars: 0,
    pages: null,
    scanRatio: 0,
    passwordProtected: false,
    extractable: false,
  }
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null
  try {
    pdf = await getDocumentProxy(bytes.slice())
    const pdfjs = await getResolvedPDFJS()
    const imageOps = new Set(
      [
        pdfjs.OPS.paintImageXObject,
        pdfjs.OPS.paintInlineImageXObject,
        pdfjs.OPS.paintImageXObjectRepeat,
        pdfjs.OPS.paintImageMaskXObject,
      ].filter((value): value is number => typeof value === "number")
    )
    const total = pdf.numPages
    const sample = samplePageNumbers(total)
    let sampledChars = 0
    let imageHeavy = 0
    for (const pageNumber of sample) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      let chars = 0
      for (const item of content.items) {
        if ("str" in item && typeof item.str === "string") chars += item.str.trim().length
      }
      sampledChars += chars
      if (chars < EMPTY_TEXT_CHARS) {
        const operators = await page.getOperatorList()
        const hasImage = operators.fnArray.some((fn) => imageOps.has(fn))
        if (hasImage) imageHeavy += 1
      }
      page.cleanup()
    }
    const estimatedChars =
      sample.length > 0 ? Math.round(sampledChars * (total / sample.length)) : 0
    return {
      ...base,
      textChars: estimatedChars,
      pages: total,
      scanRatio: sample.length > 0 ? imageHeavy / sample.length : 0,
      extractable: true,
    }
  } catch (error) {
    const name = error instanceof Error ? error.name : ""
    const message = error instanceof Error ? error.message : ""
    if (name === "PasswordException" || /password/i.test(message)) {
      return { ...base, passwordProtected: true }
    }
    return base
  } finally {
    const destroy = pdf && "destroy" in pdf ? pdf.destroy : undefined
    if (typeof destroy === "function") await destroy.call(pdf)
  }
}

function officeXmlText(bytes: Uint8Array, slide: boolean): string {
  const entries = unzipSync(bytes)
  const parts: string[] = []
  for (const [path, data] of Object.entries(entries)) {
    const wanted = slide
      ? path.startsWith("ppt/slides/slide") && path.endsWith(".xml")
      : path === "word/document.xml"
    if (!wanted) continue
    parts.push(visibleText(strFromU8(data), true))
  }
  return parts.join(" ").replace(/\s+/g, " ").trim()
}

/**
 * Reads a file the user is about to upload, or one already in storage, and
 * says whether the vector index will be able to search it.
 */
/**
 * Extension the inspector should trust. A library title often has no suffix
 * (legacy documents); `fileType` is the stored type in that case.
 */
export function extensionFor(fileName: string, fileType?: string | null): string {
  return getExtension(fileName) || (fileType ?? "").replace(/^\./, "").toLowerCase()
}

export async function inspectFileBytes(
  fileName: string,
  bytes: Uint8Array,
  fileType?: string | null
): Promise<IndexHealth> {
  const sizeBytes = bytes.byteLength
  const extension = extensionFor(fileName, fileType)

  if (sizeBytes === 0) {
    return scoreIndexHealth({
      sizeBytes: 0,
      kind: "other",
      textChars: 0,
      pages: null,
      scanRatio: 0,
      passwordProtected: false,
      extractable: false,
    })
  }

  if (extension === "pdf") {
    return scoreIndexHealth(await inspectPdf(bytes, sizeBytes))
  }

  if (extension === "doc" || (extension === "docx" && isOle(bytes))) {
    const protectedOffice = extension === "docx" && isOle(bytes)
    return scoreIndexHealth({
      sizeBytes,
      kind: "doc",
      textChars: 0,
      pages: null,
      scanRatio: 0,
      passwordProtected: protectedOffice,
      extractable: false,
    })
  }

  if (extension === "docx" || extension === "pptx") {
    if (!isZip(bytes)) {
      return scoreIndexHealth({
        sizeBytes,
        kind: extension,
        textChars: 0,
        pages: null,
        scanRatio: 0,
        passwordProtected: false,
        extractable: false,
      })
    }
    try {
      const text = officeXmlText(bytes, extension === "pptx")
      return scoreIndexHealth({
        sizeBytes,
        kind: extension,
        textChars: text.length,
        pages: null,
        scanRatio: 0,
        passwordProtected: false,
        extractable: true,
      })
    } catch {
      return scoreIndexHealth({
        sizeBytes,
        kind: extension,
        textChars: 0,
        pages: null,
        scanRatio: 0,
        passwordProtected: false,
        extractable: false,
      })
    }
  }

  if (extension === "txt" || extension === "md" || extension === "html" || extension === "json") {
    const text = visibleText(new TextDecoder("utf-8", { fatal: false }).decode(bytes), extension === "html")
    return scoreIndexHealth({
      sizeBytes,
      kind: "text",
      textChars: text.length,
      pages: null,
      scanRatio: 0,
      passwordProtected: false,
      extractable: true,
    })
  }

  return scoreIndexHealth({
    sizeBytes,
    kind: "other",
    textChars: 0,
    pages: null,
    scanRatio: 0,
    passwordProtected: false,
    extractable: false,
  })
}

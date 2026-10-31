import { stripFileCiteMarkers } from "@/lib/chat/references"
import type { CitationLocation } from "@/types/knowledge"

export const EMPTY_LOCATION: CitationLocation = {
  page: null,
  article: null,
  fileLocation: null,
}

/** Passage the user attached as context for one question. */
export interface PassageContext {
  title: string
  text: string
  location: CitationLocation
}

export interface PassageParagraph {
  kind: "paragraph"
  text: string
}

export interface PassageArticle {
  kind: "article"
  label: string
  paragraphs: string[]
}

export type PassageBlock = PassageParagraph | PassageArticle

const PAGE_KEYS = new Set([
  "page",
  "page_number",
  "page_label",
  "pagina",
  "pdf_page",
  "start_page",
  "pagina_inicio",
])
const END_PAGE_KEYS = new Set(["end_page", "pagina_fin"])
const ARTICLE_KEYS = new Set([
  "article",
  "articulo",
  "article_number",
  "numero_articulo",
])
const LOCATION_KEYS = new Set([
  "file_location",
  "location",
  "locator",
  "section",
  "seccion",
])

const PAGE_VALUE = /^\d{1,5}(?:\s*[-–]\s*\d{1,5})?(?:\s*,\s*\d{1,5}(?:\s*[-–]\s*\d{1,5})?)*$/

const ARTICLE_WORD = "Art[íi]culo|ART(?:[ÍI]CULO|ICULO)|Art\\."

const ARTICLE_HEADING = new RegExp(
  `^(?:${ARTICLE_WORD})\\s+(\\d+(?:\\s*[oº°]\\.?)?(?:\\s*(?:[Bb]is|[Tt]er|[Qq]uater|[Qq]u[aá]ter|[Qq]uinquies|[Ss]exies|[Ss]epties|[Oo]cties|[Nn]onies))?)\\s*[-–.:]*\\s*([\\s\\S]*)$`
)

const CLAUSE = /^(?:[IVXLCDM]{1,8}|[a-z]|[0-9]{1,3})[.)]\s+\S/i

function foldKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
}

function asText(value: string | number | boolean | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value === "string") {
    const trimmed = value.replace(/\s+/g, " ").trim()
    return trimmed.length > 0 ? trimmed : null
  }
  return null
}

function pageValue(value: string | number | boolean | undefined): string | null {
  const text = asText(value)
  if (!text || text.length > 40) return null
  return PAGE_VALUE.test(text) ? text.replace(/\s*-\s*/g, "–") : null
}

function shortText(
  value: string | number | boolean | undefined,
  max: number
): string | null {
  const text = asText(value)
  if (!text || text.length > max) return null
  return text
}

function articleLabelFromValue(value: string): string {
  const stripped = value
    .replace(/^(?:art(?:[íi]culo|\.))\s+/i, "")
    .replace(/[.\s]+$/, "")
    .trim()
  return stripped || value
}

/**
 * Reads a page, an article, or an in-file location from citation attributes.
 * Anything else (file name, tags, a number written inside the passage) is ignored.
 */
export function locationFromMetadata(
  attributes: Record<string, string | number | boolean> | null | undefined,
  options?: { title?: string | null; filename?: string | null }
): CitationLocation {
  if (!attributes) return { ...EMPTY_LOCATION }

  let page: string | null = null
  let endPage: string | null = null
  let article: string | null = null
  let fileLocation: string | null = null

  for (const [rawKey, rawValue] of Object.entries(attributes)) {
    const key = foldKey(rawKey)
    if (!page && PAGE_KEYS.has(key)) page = pageValue(rawValue)
    else if (!endPage && END_PAGE_KEYS.has(key)) endPage = pageValue(rawValue)
    else if (!article && ARTICLE_KEYS.has(key)) {
      const text = shortText(rawValue, 80)
      article = text ? articleLabelFromValue(text) : null
    } else if (!fileLocation && LOCATION_KEYS.has(key)) {
      fileLocation = shortText(rawValue, 200)
    }
  }

  if (page && endPage && page !== endPage && PAGE_VALUE.test(page) && !page.includes("–") && !page.includes(",")) {
    page = `${page}–${endPage}`
  }

  const names = new Set(
    [options?.title, options?.filename]
      .filter((name): name is string => Boolean(name))
      .map((name) => name.trim().toLowerCase())
  )
  if (fileLocation && names.has(fileLocation.toLowerCase())) fileLocation = null

  return { page, article, fileLocation }
}

/** Restores a location stored with a citation. Missing fields stay empty. */
export function readLocation(value: unknown): CitationLocation {
  if (!value || typeof value !== "object") return { ...EMPTY_LOCATION }
  const record = value as Record<string, unknown>
  const page = typeof record.page === "string" ? record.page.trim() : ""
  const article = typeof record.article === "string" ? record.article.trim() : ""
  const fileLocation =
    typeof record.fileLocation === "string" ? record.fileLocation.trim() : ""
  return {
    page: page ? page.slice(0, 40) : null,
    article: article ? article.slice(0, 80) : null,
    fileLocation: fileLocation ? fileLocation.slice(0, 200) : null,
  }
}

export function readPassage(value: unknown): PassageContext | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  const title = typeof record.title === "string" ? record.title.trim() : ""
  const text = typeof record.text === "string" ? record.text.trim() : ""
  if (!title || !text) return null
  return {
    title: title.slice(0, 300),
    text: text.slice(0, 4000),
    location: readLocation(record.location),
  }
}

/** Spanish line for the Fuentes card and the composer. Never invents a page. */
export function locationCaption(location: CitationLocation): string {
  const page = location.page
  const parts = [
    page
      ? `${page.includes("–") || page.includes(",") ? "Páginas" : "Página"} ${page}`
      : "La cita no incluye la página",
  ]
  if (location.article) parts.push(`Artículo ${location.article}`)
  if (location.fileLocation) parts.push(`Ubicación: ${location.fileLocation}`)
  return parts.join(" · ")
}

function joinWrapped(lines: string[]): string {
  let out = ""
  for (const line of lines) {
    if (!out) {
      out = line
      continue
    }
    if (out.endsWith("-") && /^[a-záéíóúñü]/.test(line)) {
      out = out.slice(0, -1) + line
    } else {
      out = `${out} ${line}`
    }
  }
  return out.replace(/[ \t]{2,}/g, " ").trim()
}

function matchArticle(line: string): { label: string; rest: string } | null {
  const match = ARTICLE_HEADING.exec(line)
  if (!match) return null
  const number = match[1].replace(/\s+/g, " ").replace(/[.\s]+$/, "").trim()
  const rest = match[2].replace(/^[-–.:\s]+/, "").trim()
  return { label: `Artículo ${number}`, rest }
}

/**
 * Turns a retrieved chunk into paragraphs and article sections.
 * Wrapped PDF lines are joined. Article headings stay headings.
 */
export function formatPassage(raw: string): PassageBlock[] {
  let text = stripFileCiteMarkers(raw)
  text = text.replace(/\u000c/g, "\n").replace(/\r\n?/g, "\n")
  text = text.replace(/[ \t]+\n/g, "\n")
  text = text.replace(
    new RegExp(`([^\\n])\\s+(?=(?:${ARTICLE_WORD})\\s+\\d+)`, "g"),
    "$1\n\n"
  )
  text = text.trim()
  if (!text) return []

  const blocks: PassageBlock[] = []
  let article: PassageArticle | null = null
  let buffer: string[] = []

  const pushText = (value: string) => {
    if (!value) return
    if (article) article.paragraphs.push(value)
    else blocks.push({ kind: "paragraph", text: value })
  }

  const flush = () => {
    const value = joinWrapped(buffer)
    buffer = []
    pushText(value)
  }

  const closeArticle = () => {
    flush()
    if (!article) return
    blocks.push(article)
    article = null
  }

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) {
      flush()
      continue
    }
    const heading = matchArticle(trimmed)
    if (heading) {
      closeArticle()
      article = { kind: "article", label: heading.label, paragraphs: [] }
      if (heading.rest) buffer = [heading.rest]
      continue
    }
    if (CLAUSE.test(trimmed) && buffer.length > 0) flush()
    buffer.push(trimmed)
  }
  closeArticle()
  return blocks
}

/** Model input for one question that should stay grounded in a chosen passage. */
export function questionWithPassage(question: string, passage: PassageContext): string {
  const title = passage.title.replace(/\s+/g, " ").trim()
  return [
    question.trim(),
    "",
    "Fragmento que el usuario eligió como contexto para esta pregunta.",
    `Documento: «${title}».`,
    `${locationCaption(passage.location)}.`,
    "Usa este fragmento para responder. No afirmes un número de página que no esté indicado arriba.",
    "",
    passage.text.trim(),
  ].join("\n")
}

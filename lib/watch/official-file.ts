import type { SourceDraft, SourceId } from "./sources"

/** Same ceiling as MAX_UPLOAD_BYTES in the library upload path. */
const OFFICIAL_FILE_MAX_BYTES =
  (Number.parseInt(process.env.MAX_UPLOAD_MB ?? "", 10) || 25) * 1024 * 1024

const OFFICIAL_HOSTS = new Set([
  "sidof.segob.gob.mx",
  "dof.gob.mx",
  "www.dof.gob.mx",
  "gob.mx",
  "www.gob.mx",
  "banxico.org.mx",
  "www.banxico.org.mx",
])

export interface OfficialDocument {
  bytes: Buffer
  fileName: string
  contentType: string
  /** The browser can show this inside the page. */
  previewInline: boolean
}

/** HTTPS URL on a host this watcher is allowed to download from. */
export function isAllowedOfficialUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== "https:") return false
    if (url.username || url.password) return false
    return OFFICIAL_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function dofDocUrl(externalId: string): string | null {
  if (!/^\d{3,12}$/.test(externalId)) return null
  return `https://sidof.segob.gob.mx/dof/sidof/documentos/doc/${externalId}`
}

export function dofNoteApiUrl(externalId: string): string | null {
  if (!/^\d{3,12}$/.test(externalId)) return null
  return `https://sidof.segob.gob.mx/dof/sidof/notas/nota/${externalId}`
}

export function libraryFileName(title: string, ext: string): string {
  const cleaned = title
    .replace(/[\u0000-\u001f]/g, " ")
    .replace(/[\\/:*?"<>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 180)
  const stem = cleaned || "documento"
  const suffix = `.${ext.replace(/^\./, "").toLowerCase()}`
  const named = stem.toLowerCase().endsWith(suffix) ? stem : `${stem}${suffix}`
  return named.slice(0, 240)
}

export type OfficialExt = "pdf" | "doc" | "docx" | "pptx" | "html" | "txt"

/** File kind from magic bytes, falling back to the content type or URL. */
export function sniffOfficial(bytes: Uint8Array, hint: string): OfficialExt | null {
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString() === "%PDF-") {
    return "pdf"
  }
  if (
    bytes.length >= 4 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    return "doc"
  }
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const folded = hint.toLowerCase()
    if (folded.includes("pptx") || folded.includes("presentationml")) return "pptx"
    if (
      folded.includes("docx") ||
      folded.includes("wordprocessingml") ||
      folded.includes("msword") ||
      folded.includes(".doc")
    ) {
      return "docx"
    }
    return null
  }
  const folded = hint.toLowerCase()
  if (folded.includes("application/pdf")) return "pdf"
  if (folded.includes("text/html")) return "html"
  if (folded.includes("text/plain")) return "txt"
  return null
}

/** Visible text long enough to be the document, and not a bot-check page. */
export function usableHtmlDocument(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes).toString("utf8")
  if (/challenge validation|sec-cpt|access denied|just a moment/i.test(text)) return false
  const visible = text
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  return visible.length >= 400
}

/** PDF, Word and PowerPoint links on an official page. */
export function extractOfficialDownloads(html: string, pageUrl: string): string[] {
  const found: string[] = []
  const seen = new Set<string>()
  for (const match of Array.from(html.matchAll(/href\s*=\s*["']([^"']+)["']/gi))) {
    const raw = match[1]
    if (!/\.(pdf|docx?|pptx?)(?:$|[?#])/i.test(raw)) continue
    let absolute: string
    try {
      absolute = new URL(raw, pageUrl).toString()
    } catch {
      continue
    }
    if (!isAllowedOfficialUrl(absolute) || seen.has(absolute)) continue
    seen.add(absolute)
    found.push(absolute)
  }
  return found
}

/**
 * Prefer a PDF or modern Office file. An old Word .doc is replaced by the
 * official note HTML when that text exists, because the index cannot read .doc.
 */
export function preferReadableOfficial(input: {
  binary: { bytes: Buffer; ext: OfficialExt } | null
  html: string | null
}): { bytes: Buffer; ext: OfficialExt } | null {
  if (input.binary && input.binary.ext !== "doc" && input.binary.ext !== "html") {
    return input.binary
  }
  if (input.html) {
    const bytes = Buffer.from(input.html, "utf8")
    if (bytes.length <= OFFICIAL_FILE_MAX_BYTES && usableHtmlDocument(bytes)) {
      return { bytes, ext: "html" }
    }
  }
  if (input.binary && input.binary.ext !== "html") return input.binary
  return null
}

const INLINE_EXT = new Set<OfficialExt>(["pdf", "html", "txt"])

function contentTypeFor(ext: OfficialExt): string {
  switch (ext) {
    case "pdf":
      return "application/pdf"
    case "doc":
      return "application/msword"
    case "docx":
      return "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    case "pptx":
      return "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    case "html":
      return "text/html; charset=utf-8"
    case "txt":
      return "text/plain; charset=utf-8"
    default: {
      const unknown: never = ext
      return unknown
    }
  }
}

interface RemoteBody {
  bytes: Buffer
  hint: string
}

async function readOfficial(url: string): Promise<RemoteBody | null> {
  if (!isAllowedOfficialUrl(url)) return null
  let current = url
  for (let hop = 0; hop < 4; hop += 1) {
    let response: Response
    try {
      response = await fetch(current, {
        redirect: "manual",
        headers: {
          Accept: "*/*",
          "User-Agent": "DocumentSearch/1.0",
        },
        signal: AbortSignal.timeout(20000),
      })
    } catch {
      return null
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location")
      if (!location) return null
      const next = new URL(location, current).toString()
      if (!isAllowedOfficialUrl(next)) return null
      current = next
      continue
    }
    if (!response.ok) return null
    const announced = Number(response.headers.get("content-length") || "0")
    if (announced > OFFICIAL_FILE_MAX_BYTES) return null
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.length === 0 || bytes.length > OFFICIAL_FILE_MAX_BYTES) return null
    const hint = [
      response.headers.get("content-type") ?? "",
      response.headers.get("content-disposition") ?? "",
      current,
    ].join(" ")
    return { bytes, hint }
  }
  return null
}

function asAllowedFile(
  remote: RemoteBody | null,
  allowed: OfficialExt[]
): { bytes: Buffer; ext: OfficialExt } | null {
  if (!remote) return null
  const ext = sniffOfficial(remote.bytes, remote.hint)
  if (!ext || !allowed.includes(ext)) return null
  if ((ext === "html" || ext === "txt") && !usableHtmlDocument(remote.bytes)) return null
  return { bytes: remote.bytes, ext }
}

async function dofNoteHtml(externalId: string): Promise<string | null> {
  const url = dofNoteApiUrl(externalId)
  if (!url) return null
  let response: Response
  try {
    response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "DocumentSearch/1.0" },
      signal: AbortSignal.timeout(20000),
    })
  } catch {
    return null
  }
  if (!response.ok) return null
  let payload: { Nota?: { cadenaContenido?: unknown } }
  try {
    payload = (await response.json()) as { Nota?: { cadenaContenido?: unknown } }
  } catch {
    return null
  }
  const html = payload.Nota?.cadenaContenido
  if (typeof html !== "string") return null
  if (Buffer.byteLength(html) > OFFICIAL_FILE_MAX_BYTES) return null
  return html
}

function pack(title: string, file: { bytes: Buffer; ext: OfficialExt }): OfficialDocument {
  return {
    bytes: file.bytes,
    fileName: libraryFileName(title, file.ext),
    contentType: contentTypeFor(file.ext),
    previewInline: INLINE_EXT.has(file.ext),
  }
}

async function fetchDof(draft: SourceDraft): Promise<OfficialDocument | null> {
  const binary = asAllowedFile(await readOfficial(dofDocUrl(draft.externalId) ?? ""), [
    "pdf",
    "doc",
    "docx",
    "pptx",
  ])
  const chosen = preferReadableOfficial({
    binary,
    html: binary?.ext === "doc" || !binary ? await dofNoteHtml(draft.externalId) : null,
  })
  return chosen ? pack(draft.title, chosen) : null
}

async function fetchLinked(draft: SourceDraft): Promise<OfficialDocument | null> {
  const direct = asAllowedFile(await readOfficial(draft.url), ["pdf", "doc", "docx", "pptx"])
  if (direct) return pack(draft.title, direct)
  const page = await readOfficial(draft.url)
  if (!page) return null
  const html = page.bytes.toString("utf8")
  for (const link of extractOfficialDownloads(html, draft.url)) {
    const file = asAllowedFile(await readOfficial(link), ["pdf", "doc", "docx", "pptx"])
    if (file) return pack(draft.title, file)
  }
  return null
}

/** Downloads the official file for one source item. Null when it cannot be fetched. */
export async function fetchOfficialDocument(
  draft: Pick<SourceDraft, "source" | "externalId" | "url" | "title">
): Promise<OfficialDocument | null> {
  const full: SourceDraft = {
    source: draft.source,
    externalId: draft.externalId,
    url: draft.url,
    title: draft.title,
    publishedOn: null,
    organ: null,
  }
  const source: SourceId = full.source
  switch (source) {
    case "dof":
      return fetchDof(full)
    case "cnbv":
    case "banxico":
      return fetchLinked(full)
    default: {
      const unknown: never = source
      return unknown
    }
  }
}

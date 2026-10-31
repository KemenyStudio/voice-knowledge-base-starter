export const SOURCE_IDS = ["dof", "cnbv", "banxico"] as const
export type SourceId = (typeof SOURCE_IDS)[number]

export interface SourceDraft {
  source: SourceId
  externalId: string
  title: string
  url: string
  publishedOn: string | null
  organ: string | null
}

export interface SourceReport {
  source: SourceId
  found: number
  error?: string
}

export function sourceLabel(source: SourceId): string {
  switch (source) {
    case "dof":
      return "Diario Oficial"
    case "cnbv":
      return "CNBV"
    case "banxico":
      return "Banxico"
    default: {
      const unknown: never = source
      return unknown
    }
  }
}

interface DofNote {
  codNota?: number
  codOrgaDos?: string | null
  fecha?: string | null
  titulo?: string | null
}

export function isWatchedOrgan(organ: string | null | undefined): boolean {
  const folded = (organ ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
  return (
    folded.includes("banco de mexico") ||
    folded.includes("comision nacional bancaria") ||
    folded.includes("secretaria de hacienda")
  )
}

export function dofPublicUrl(codNota: number, fecha: string): string {
  const [day, month, year] = fecha.split("-")
  return `https://www.dof.gob.mx/nota_detalle.php?codigo=${codNota}&fecha=${day}/${month}/${year}`
}

export function isoFromDofDate(fecha: string): string | null {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(fecha)
  if (!match) return null
  return `${match[3]}-${match[2]}-${match[1]}`
}

export function watchedDofNotes(notes: DofNote[]): DofNote[] {
  return notes.filter(
    (note) => typeof note.codNota === "number" && isWatchedOrgan(note.codOrgaDos)
  )
}

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function parseCnbvDocuments(html: string): SourceDraft[] {
  const headings = Array.from(html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi))
    .map((match) => decodeHtml(match[1]))
    .filter((title) => title.length > 8 && !/continuar leyendo/i.test(title))
  const links: string[] = []
  const seen = new Set<string>()
  for (const match of Array.from(html.matchAll(/href="(\/cnbv\/documentos\/[^"#?]+)"/gi))) {
    const path = match[1]
    if (seen.has(path)) continue
    seen.add(path)
    links.push(path)
  }
  const drafts: SourceDraft[] = []
  const count = Math.min(headings.length, links.length, 12)
  for (let i = 0; i < count; i++) {
    drafts.push({
      source: "cnbv",
      externalId: links[i],
      title: headings[i].slice(0, 240),
      url: `https://www.gob.mx${links[i]}`,
      publishedOn: null,
      organ: "CNBV",
    })
  }
  return drafts
}

export function parseBanxicoConsultations(html: string): SourceDraft[] {
  const drafts: SourceDraft[] = []
  const chunks = html.split(/<li\b/i).slice(1)
  for (const chunk of chunks) {
    if (!chunk.includes("downloadFile")) continue
    const rawTitle = (chunk.split(/<br|<span|<a\b/i)[0] ?? "").replace(/^[^>]*>/, "")
    const title = decodeHtml(rawTitle)
    if (title.length < 12) continue
    const links = Array.from(
      chunk.matchAll(/href="(downloadFile\?fileId=\{([^}]+)\})"[^>]*>([^<]*)</gi)
    )
    if (links.length === 0) continue
    const preferred =
      links.find((link) => /proyecto|disposici/i.test(link[3])) ?? links[0]
    const date = chunk.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    drafts.push({
      source: "banxico",
      externalId: preferred[2],
      title: title.slice(0, 240),
      url: `https://www.banxico.org.mx/ConsultaRegulacionWeb/${preferred[1]}`,
      publishedOn: date ? `${date[3]}-${date[2]}-${date[1]}` : null,
      organ: "Banco de México",
    })
    if (drafts.length >= 12) break
  }
  return drafts
}

function mexicoDate(daysAgo: number): string {
  const when = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Mexico_City",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(when)
  const day = parts.find((part) => part.type === "day")?.value ?? "01"
  const month = parts.find((part) => part.type === "month")?.value ?? "01"
  const year = parts.find((part) => part.type === "year")?.value ?? "2026"
  return `${day}-${month}-${year}`
}

async function readText(url: string, encoding: "utf-8" | "iso-8859-1"): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: encoding === "utf-8" ? "application/json, text/html" : "text/html",
      "User-Agent": "DocumentSearch/1.0",
    },
    signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const buffer = await response.arrayBuffer()
  return new TextDecoder(encoding).decode(buffer)
}

async function collectDof(): Promise<{ drafts: SourceDraft[]; error?: string }> {
  const candidates: DofNote[] = []
  let failures = 0
  for (let daysAgo = 0; daysAgo < 6; daysAgo++) {
    const fecha = mexicoDate(daysAgo)
    try {
      const payload = JSON.parse(
        await readText(
          `https://sidof.segob.gob.mx/dof/sidof/notas/${fecha}`,
          "utf-8"
        )
      ) as {
        NotasMatutinas?: DofNote[]
        NotasVespertinas?: DofNote[]
        NotasExtraordinarias?: DofNote[]
      }
      const notes = [
        ...(payload.NotasMatutinas ?? []),
        ...(payload.NotasVespertinas ?? []),
        ...(payload.NotasExtraordinarias ?? []),
      ]
      candidates.push(...watchedDofNotes(notes))
    } catch {
      failures += 1
    }
  }
  if (candidates.length === 0 && failures === 6) {
    return { drafts: [], error: "No se pudo leer el Diario Oficial." }
  }

  const seen = new Set<number>()
  const picked = candidates.filter((note) => {
    if (!note.codNota || seen.has(note.codNota)) return false
    seen.add(note.codNota)
    return true
  }).slice(0, 12)

  const drafts: SourceDraft[] = []
  for (const note of picked) {
    if (!note.codNota || !note.fecha) continue
    try {
      const detail = JSON.parse(
        await readText(
          `https://sidof.segob.gob.mx/dof/sidof/notas/nota/${note.codNota}`,
          "utf-8"
        )
      ) as { Nota?: DofNote }
      const title = detail.Nota?.titulo?.replace(/\s+/g, " ").trim()
      if (!title) continue
      drafts.push({
        source: "dof",
        externalId: String(note.codNota),
        title: title.slice(0, 240),
        url: dofPublicUrl(note.codNota, note.fecha),
        publishedOn: isoFromDofDate(note.fecha),
        organ: note.codOrgaDos ?? null,
      })
    } catch {
      // A single note can fail without dropping the rest of the day.
    }
  }
  return { drafts }
}

async function collectCnbv(): Promise<{ drafts: SourceDraft[]; error?: string }> {
  try {
    const html = await readText(
      "https://www.gob.mx/cnbv/archivo/documentos?idiom=es&order=DESC&page=1",
      "utf-8"
    )
    return { drafts: parseCnbvDocuments(html) }
  } catch {
    return { drafts: [], error: "No se pudo leer la CNBV." }
  }
}

async function collectBanxico(): Promise<{ drafts: SourceDraft[]; error?: string }> {
  try {
    const html = await readText(
      "https://www.banxico.org.mx/ConsultaRegulacionWeb/",
      "iso-8859-1"
    )
    return { drafts: parseBanxicoConsultations(html) }
  } catch {
    return { drafts: [], error: "No se pudo leer Banxico." }
  }
}

/** Reads the three public pages. A failed source does not cancel the others. */
export async function collectSourceDrafts(): Promise<{
  drafts: SourceDraft[]
  reports: SourceReport[]
}> {
  const [dof, cnbv, banxico] = await Promise.all([
    collectDof(),
    collectCnbv(),
    collectBanxico(),
  ])
  const groups = [
    { source: "dof" as const, ...dof },
    { source: "cnbv" as const, ...cnbv },
    { source: "banxico" as const, ...banxico },
  ]
  return {
    drafts: groups.flatMap((group) => group.drafts),
    reports: groups.map((group) => ({
      source: group.source,
      found: group.drafts.length,
      ...(group.error ? { error: group.error } : {}),
    })),
  }
}

/**
 * Settings for the separate web_search tool. No library search lives here.
 *
 * https://developers.openai.com/api/docs/guides/tools-web-search
 */

export interface WebSource {
  title: string
  url: string
  /** Distinguishes these hits from library citations. */
  origin: "web"
}

export interface WebLookup {
  note: string
  sources: WebSource[]
}

/** Official Mexican publications. Subdomains are included by the API. */
export const OFFICIAL_WEB_DOMAINS = [
  "banxico.org.mx",
  "cnbv.gob.mx",
  "dof.gob.mx",
  "diputados.gob.mx",
  "gob.mx",
  "ordenjuridico.gob.mx",
  "hacienda.gob.mx",
  "sat.gob.mx",
  "condusef.gob.mx",
  "shcp.gob.mx",
] as const

const NEWER =
  /m[aá]s reciente|m[aá]s nuev|newer official|more recent official|latest official|actualizaci[oó]n oficial/i
const OFFICIAL = /fuente oficial|official source|diario oficial|sitio oficial|publicaci[oó]n oficial/i

/**
 * True only when the question asks whether a newer official source exists.
 * A legal question that merely names an official text stays on file_search.
 */
export function asksForNewerOfficialSource(question: string): boolean {
  const text = question.trim()
  if (text.length < 12 || text.length > 500) return false
  return NEWER.test(text) && OFFICIAL.test(text)
}

export function officialWebSearchTool() {
  return {
    type: "web_search" as const,
    external_web_access: true,
    search_context_size: "high" as const,
    user_location: {
      type: "approximate" as const,
      country: "MX",
      city: "Ciudad de México",
      region: "Ciudad de México",
      timezone: "America/Mexico_City",
    },
    filters: {
      allowed_domains: [...OFFICIAL_WEB_DOMAINS],
    },
  }
}

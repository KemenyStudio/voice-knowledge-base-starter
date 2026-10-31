/**
 * Tools an assistant can offer under its answers. They only produce text for
 * the user to copy or download: none of them sends, deletes or changes
 * anything. Each assistant lists the ones it allows in `chatbots.enabled_tools`
 * and every run is written to `tool_runs`.
 */
export const TOOL_IDS = ["draft_email", "memo", "check_validity"] as const
export type ToolId = (typeof TOOL_IDS)[number]

/**
 * Separate from the library tools. Always available: it does not replace
 * file_search and it is not stored in enabled_tools.
 */
export const WEB_TOOL_ID = "newer_official_source" as const
export const RUNNABLE_TOOL_IDS = [...TOOL_IDS, WEB_TOOL_ID] as const
export type RunnableToolId = (typeof RUNNABLE_TOOL_IDS)[number]

export interface ToolInfo {
  id: RunnableToolId
  label: string
  description: string
  /** What the tool works on. */
  target: "answer" | "document"
}

export const TOOLS: Record<ToolId, ToolInfo> = {
  draft_email: {
    id: "draft_email",
    label: "Redactar correo",
    description: "Convierte la respuesta en un borrador de correo para copiar.",
    target: "answer",
  },
  memo: {
    id: "memo",
    label: "Crear memorando",
    description: "Genera un memorando con resumen, análisis y fuentes a partir de la respuesta.",
    target: "answer",
  },
  check_validity: {
    id: "check_validity",
    label: "Verificar vigencia",
    description: "Busca en el documento su fecha de publicación, entrada en vigor, reformas y derogaciones.",
    target: "document",
  },
}

export const WEB_TOOL: ToolInfo = {
  id: WEB_TOOL_ID,
  label: "Fuente oficial más reciente",
  description:
    "Busca en sitios oficiales si hay una publicación más nueva. Los resultados se marcan como web y no sustituyen la biblioteca.",
  target: "answer",
}

export function toolInfo(id: RunnableToolId): ToolInfo {
  if (id === WEB_TOOL_ID) return WEB_TOOL
  return TOOLS[id]
}

export function isToolId(value: unknown): value is ToolId {
  return typeof value === "string" && (TOOL_IDS as readonly string[]).includes(value)
}

/** Keeps only known tool ids, without duplicates. */
export function normalizeTools(values: unknown): ToolId[] {
  if (!Array.isArray(values)) return []
  return Array.from(new Set(values.filter(isToolId)))
}

/** Tool runs per user and assistant in one hour. */
export const TOOL_HOURLY_LIMIT = 30
export const INSTRUCTIONS_MAX_LENGTH = 300

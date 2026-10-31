import type { Response as OpenAIResponse } from "openai/resources/responses/responses"
import type { ResponseFunctionWebSearch } from "openai/resources/responses/responses"

import {
  officialWebSearchTool,
  type WebLookup,
  type WebSource,
} from "@/lib/official-web"
import { aiConfig, getOpenAI } from "@/lib/openai"

export type { WebLookup, WebSource } from "@/lib/official-web"
export {
  OFFICIAL_WEB_DOMAINS,
  asksForNewerOfficialSource,
  officialWebSearchTool,
} from "@/lib/official-web"

const WEB_INSTRUCTIONS = `Buscas si existe una publicación oficial más reciente. No respondes la pregunta jurídica: eso corresponde a la biblioteca.
- Usa solo la búsqueda web. No cites documentos de la biblioteca ni uses números entre corchetes.
- Escribe en español, en un párrafo corto.
- Si no aparece una publicación más nueva en los sitios oficiales, dilo.
- No inventes direcciones.`

/** Separate Responses call. file_search is not one of its tools. */
export async function searchNewerOfficialSource(input: {
  question: string
  documentTitle?: string | null
  libraryExcerpt?: string | null
}): Promise<WebLookup> {
  const lines = [`Pregunta: ${input.question.trim()}`]
  if (input.documentTitle?.trim()) {
    lines.push(`Documento de la biblioteca: «${input.documentTitle.trim()}»`)
  }
  if (input.libraryExcerpt?.trim()) {
    lines.push(
      `Extracto de la respuesta de la biblioteca (solo contexto, no es una fuente web):\n${input.libraryExcerpt.trim().slice(0, 1500)}`
    )
  }
  lines.push(`Fecha de hoy: ${new Date().toISOString().slice(0, 10)}`)

  const response = await getOpenAI().responses.create({
    model: aiConfig.answerModel,
    reasoning: { effort: "low" },
    text: { verbosity: "low" },
    instructions: WEB_INSTRUCTIONS,
    input: lines.join("\n\n"),
    tools: [officialWebSearchTool()],
    tool_choice: "required",
    include: ["web_search_call.action.sources"],
    max_output_tokens: 1200,
    store: false,
  })

  const note =
    response.output_text?.trim() ||
    "No apareció una fuente oficial más reciente en la búsqueda web."
  return { note, sources: sourcesFrom(response) }
}

function sourcesFrom(response: OpenAIResponse): WebSource[] {
  const byUrl = new Map<string, WebSource>()
  const add = (url: string | null | undefined, title?: string | null) => {
    const clean = (url ?? "").trim()
    if (!/^https?:\/\//i.test(clean)) return
    const current = byUrl.get(clean)
    const nextTitle = title?.trim() || current?.title || clean
    byUrl.set(clean, { title: nextTitle, url: clean, origin: "web" })
  }

  for (const item of response.output) {
    if (item.type === "web_search_call") addAction(item.action, add)
    if (item.type !== "message") continue
    for (const part of item.content) {
      if (part.type !== "output_text") continue
      for (const annotation of part.annotations) {
        if (annotation.type === "url_citation") add(annotation.url, annotation.title)
      }
    }
  }
  return Array.from(byUrl.values())
}

function addAction(
  action: ResponseFunctionWebSearch["action"],
  add: (url: string | null | undefined, title?: string | null) => void
): void {
  switch (action.type) {
    case "search":
      for (const source of action.sources ?? []) add(source.url)
      return
    case "open_page":
      add(action.url)
      return
    case "find_in_page":
      add(action.url)
      return
    default: {
      const unknown: never = action
      void unknown
    }
  }
}

import type {
  FileSearchTool,
  Response as OpenAIResponse,
  ResponseFileSearchToolCall,
} from "openai/resources/responses/responses"

import { aiConfig, getOpenAI } from "@/lib/openai"
import { fileSearchTool, joinPassages } from "@/lib/retrieval"
import type { AnySupabase } from "@/lib/supabase/server"
import type { ChatbotRow } from "@/types/knowledge"
import { voiceSearchGeneration, type VoiceLength } from "@/lib/voice/call-settings"
import { citedLibrarySpeech } from "@/lib/voice/cited"
import { buildSearchInstructions } from "@/lib/voice/instructions"
import type { TranscriptCitation } from "@/lib/voice/transcript"

const EXCERPT_LIMIT = 2400

interface Passage {
  file_id?: string | null
  filename?: string | null
  text?: string | null
  score?: number | null
}

export interface LibraryDocument {
  numero: number
  titulo: string
  extracto: string
  desactualizado: boolean
}

export interface LibraryAnswer {
  respuesta: string
  documentos: LibraryDocument[]
  filtro_entidad: { aplicado: boolean; entidad: string } | null
  citations: TranscriptCitation[]
  /** True only when a retrieved passage contains the text that will be spoken. */
  cited: boolean
}

/**
 * Runs file_search on the assistant's vector store, the same tool POST /api/chat
 * uses. The spoken model reads `respuesta`; it does not search a second index.
 */
export async function answerFromLibrary(input: {
  supabase: AnySupabase
  chatbot: ChatbotRow
  vectorStoreId: string
  entity: string | null
  filter: NonNullable<FileSearchTool["filters"]> | null
  entityFilter: { applied: boolean; entity: string } | null
  query: string
  length?: VoiceLength
}): Promise<LibraryAnswer> {
  const length = input.length ?? "normal"
  const generation = voiceSearchGeneration(length, aiConfig.maxOutputTokens)
  const openai = getOpenAI()
  const response = await openai.responses.create({
    model: aiConfig.answerModel,
    instructions: buildSearchInstructions(input.chatbot, input.entity, length),
    input: [{ role: "user", content: input.query }],
    tools: [
      fileSearchTool({
        vectorStoreId: input.vectorStoreId,
        maxNumResults: aiConfig.fileSearchMaxResults,
        filters: input.filter,
      }),
    ],
    tool_choice: { type: "file_search" },
    include: ["file_search_call.results"],
    reasoning: { effort: aiConfig.answerEffort },
    text: { verbosity: generation.verbosity },
    max_output_tokens: generation.max_output_tokens,
    store: false,
  })

  const documents = await documentsFrom(input.supabase, input.chatbot.id, response)
  const speech = citedLibrarySpeech(documents)

  return {
    respuesta: speech.respuesta,
    documentos: speech.documentos,
    filtro_entidad: input.entityFilter
      ? { aplicado: input.entityFilter.applied, entidad: input.entityFilter.entity }
      : null,
    citations: speech.documentos.map((doc) => ({
      number: doc.numero,
      title: doc.titulo,
      ...(doc.desactualizado ? { outdated: true } : {}),
    })),
    cited: speech.cited,
  }
}

async function documentsFrom(
  supabase: AnySupabase,
  chatbotId: string,
  response: OpenAIResponse
): Promise<LibraryDocument[]> {
  const retrieved = response.output
    .filter(
      (item): item is ResponseFileSearchToolCall => item.type === "file_search_call"
    )
    .flatMap((item) => item.results ?? [])

  const best = new Map<string, Passage & { passages: Array<{ text: string; score: number }> }>()
  for (const result of retrieved) {
    const key = result.file_id ?? result.filename
    if (!key) continue
    const text = (result.text ?? "").trim()
    let current = best.get(key)
    if (!current) {
      current = { ...result, passages: [] }
      best.set(key, current)
    } else if ((result.score ?? 0) > (current.score ?? 0)) {
      current.score = result.score
      current.text = result.text
    }
    if (text && !current.passages.some((passage) => passage.text === text)) {
      current.passages.push({ text, score: result.score ?? 0 })
    }
  }
  const ordered = Array.from(best.keys())
  if (ordered.length === 0) return []

  const fileIds = ordered.filter((id) => id.startsWith("file-"))
  const filenames = Array.from(
    new Set(
      ordered
        .map((id) => best.get(id)?.filename)
        .filter((name): name is string => Boolean(name))
    )
  )

  const [byId, byName] = await Promise.all([
    fileIds.length
      ? supabase
          .from("files")
          .select("file_name, openai_file_id, outdated")
          .eq("chatbot_id", chatbotId)
          .in("openai_file_id", fileIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
    filenames.length
      ? supabase
          .from("files")
          .select("file_name, openai_file_id, outdated")
          .eq("chatbot_id", chatbotId)
          .in("file_name", filenames)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>>, error: null }),
  ])
  if (byId.error) throw byId.error
  if (byName.error) throw byName.error

  const rowByOpenAiId = new Map<string, { file_name: string; outdated: boolean }>()
  for (const row of byId.data ?? []) {
    if (typeof row.openai_file_id === "string") {
      rowByOpenAiId.set(row.openai_file_id, {
        file_name: String(row.file_name ?? ""),
        outdated: Boolean(row.outdated),
      })
    }
  }
  const rowByName = new Map<string, { file_name: string; outdated: boolean }>()
  for (const row of byName.data ?? []) {
    if (typeof row.file_name === "string") {
      rowByName.set(row.file_name, {
        file_name: row.file_name,
        outdated: Boolean(row.outdated),
      })
    }
  }

  return ordered.map((key, index) => {
    const result = best.get(key)!
    const row =
      (result.file_id && rowByOpenAiId.get(result.file_id)) ||
      (result.filename && rowByName.get(result.filename)) ||
      null
    const extracto = joinPassages(result.passages, EXCERPT_LIMIT).replace(/\s+/g, " ").trim()
    return {
      numero: index + 1,
      titulo: row?.file_name || result.filename || "Documento",
      extracto,
      desactualizado: Boolean(row?.outdated),
    }
  })
}

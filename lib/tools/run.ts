import { focusFilter } from "@/lib/document-actions"
import { HttpError } from "@/lib/http"
import { aiConfig, getOpenAI } from "@/lib/openai"
import { fileSearchTool } from "@/lib/retrieval"
import type { AnySupabase } from "@/lib/supabase/server"
import type { ChatbotRow } from "@/types/knowledge"
import { searchNewerOfficialSource, type WebLookup } from "@/lib/web-search"

import {
  INSTRUCTIONS_MAX_LENGTH,
  TOOL_HOURLY_LIMIT,
  WEB_TOOL_ID,
  normalizeTools,
  toolInfo,
  type RunnableToolId,
} from "./registry"

export interface ToolRequest {
  tool: RunnableToolId
  messageId?: string
  fileId?: string
  instructions?: string
}

export interface ToolContext {
  /** Client scoped to the signed-in user (RLS applies). */
  supabase: AnySupabase
  /** Service role, used only to write the audit log. */
  admin: AnySupabase
  userId: string
  chatbot: ChatbotRow
}

const BASE_RULES = `Reglas:
- Usa únicamente la información de la respuesta o del documento que se te da. No agregues hechos, cifras ni fechas nuevas.
- Mantén las referencias: cuando cites un dato, menciona el documento por su título (no uses números entre corchetes).
- Escribe en español, con tono profesional y claro.
- Si falta información para algo que se pide, dilo en una línea en lugar de inventarla.`

const EMAIL_PROMPT = `Redacta un borrador de correo electrónico a partir de la respuesta del asistente.
Formato exacto: primera línea "Asunto: ...", una línea en blanco y el cuerpo (saludo, 2 a 4 párrafos cortos o viñetas, cierre). Termina con una línea "Fuentes:" y los títulos de los documentos usados.
${BASE_RULES}`

const MEMO_PROMPT = `Redacta un memorando en Markdown a partir de la respuesta del asistente, con estas secciones: "# Memorando", datos (Asunto, Fecha de elaboración: la de hoy, Elaborado con: asistente), "## Resumen ejecutivo" (3 a 5 líneas), "## Análisis" (hallazgos y obligaciones, con plazos si los hay), "## Puntos de atención" (riesgos o dudas abiertas), "## Fuentes" (títulos de los documentos).
${BASE_RULES}`

const VALIDITY_PROMPT = `Revisa los pasajes del documento y responde, en viñetas cortas, solo lo que aparezca en ellos:
- Fecha de publicación (por ejemplo en el Diario Oficial) y fecha de entrada en vigor.
- Reformas o modificaciones posteriores (con fechas).
- Si indica que deroga, abroga o sustituye a otros documentos, o si alguien lo sustituye a él.
- Disposiciones transitorias con plazos que aún puedan importar.
Si un punto no aparece en los pasajes, escribe "No aparece en los pasajes revisados". No afirmes que el documento está vigente o derogado si el texto no lo dice: indica que la vigencia debe confirmarse en la fuente oficial.`

async function complete(instructions: string, input: string): Promise<string> {
  const response = await getOpenAI().responses.create({
    model: aiConfig.answerModel,
    reasoning: { effort: "low" },
    text: { verbosity: "medium" },
    instructions,
    input,
    max_output_tokens: 3500,
    store: false,
  })
  const text = response.output_text?.trim()
  if (!text) throw new Error("The model returned no text")
  return text
}

/** An answer of the user's own conversation, with the question that led to it. */
async function loadAnswer(
  ctx: ToolContext,
  messageId: string
): Promise<{ question: string; answer: string }> {
  const { data: message, error } = await ctx.supabase
    .from("chat_messages")
    .select("id, content, session_id, created_at, role")
    .eq("id", messageId)
    .eq("user_id", ctx.userId)
    .eq("chatbot_id", ctx.chatbot.id)
    .maybeSingle()
  if (error) throw error
  if (!message || message.role !== "assistant") {
    throw new HttpError(404, "Answer not found")
  }
  const { data: question } = await ctx.supabase
    .from("chat_messages")
    .select("content")
    .eq("user_id", ctx.userId)
    .eq("chatbot_id", ctx.chatbot.id)
    .eq("session_id", message.session_id)
    .eq("role", "user")
    .lt("created_at", message.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  return { question: question?.content ?? "", answer: message.content }
}

async function checkValidity(ctx: ToolContext, fileId: string): Promise<string> {
  const { data: file, error } = await ctx.supabase
    .from("files")
    .select("id, file_name, openai_file_id, outdated, outdated_note, superseded_by")
    .eq("id", fileId)
    .eq("chatbot_id", ctx.chatbot.id)
    .maybeSingle()
  if (error) throw error
  if (!file) throw new HttpError(404, "Document not found in this assistant")
  if (!file.openai_file_id || !ctx.chatbot.vector_store_id) {
    throw new HttpError(409, "The document is not indexed yet")
  }

  // What the team already knows, from the Library itself.
  const known: string[] = []
  if (file.outdated) {
    known.push(
      `Un administrador marcó este documento como desactualizado${file.outdated_note ? `: ${file.outdated_note}` : "."}`
    )
  }
  if (file.superseded_by) {
    const { data: newer } = await ctx.supabase
      .from("files")
      .select("file_name")
      .eq("id", file.superseded_by)
      .maybeSingle()
    if (newer) known.push(`En la Biblioteca fue sustituido por «${newer.file_name}».`)
  }

  const response = await getOpenAI().responses.create({
    model: aiConfig.answerModel,
    reasoning: { effort: "low" },
    text: { verbosity: "low" },
    instructions: VALIDITY_PROMPT,
    input: `Documento: «${file.file_name}». Busca su publicación, entrada en vigor, reformas, derogaciones y transitorios.`,
    tools: [
      fileSearchTool({
        vectorStoreId: ctx.chatbot.vector_store_id,
        maxNumResults: 20,
        filters: focusFilter([file.id]),
      }),
    ],
    tool_choice: { type: "file_search" },
    max_output_tokens: 1500,
    store: false,
  })
  const found = response.output_text?.trim()
  if (!found) throw new Error("The model returned no text")
  return [
    `# Vigencia: ${file.file_name}`,
    known.length ? `## Lo que sabe tu equipo\n${known.map((k) => `- ${k}`).join("\n")}` : "",
    `## Lo que dice el documento\n${found}`,
  ]
    .filter(Boolean)
    .join("\n\n")
}

/** Tool runs of this user in the last hour (rate limit). */
async function runsLastHour(ctx: ToolContext): Promise<number> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString()
  const { count, error } = await ctx.admin
    .from("tool_runs")
    .select("id", { count: "exact", head: true })
    .eq("chatbot_id", ctx.chatbot.id)
    .eq("user_id", ctx.userId)
    .gte("created_at", since)
  if (error) throw error
  return count ?? 0
}

async function produce(
  ctx: ToolContext,
  request: ToolRequest,
  instructions: string | undefined
): Promise<{ text: string; webSources?: WebLookup }> {
  switch (request.tool) {
    case "check_validity":
      return { text: await checkValidity(ctx, request.fileId!) }
    case "newer_official_source":
      return newerOfficialSource(ctx, request, instructions)
    case "draft_email":
    case "memo": {
      const { question, answer } = await loadAnswer(ctx, request.messageId!)
      const prompt = request.tool === "draft_email" ? EMAIL_PROMPT : MEMO_PROMPT
      return {
        text: await complete(
          prompt,
          `Pregunta original:\n${question}\n\nRespuesta del asistente:\n${answer.slice(0, 12000)}${
            instructions ? `\n\nIndicaciones del usuario para este texto:\n${instructions}` : ""
          }\n\nFecha de hoy: ${new Date().toISOString().slice(0, 10)}`
        ),
      }
    }
    default: {
      const unknown: never = request.tool
      throw new HttpError(400, `Unknown tool ${String(unknown)}`)
    }
  }
}

/** Web lookup only. file_search is not offered on this call. */
async function newerOfficialSource(
  ctx: ToolContext,
  request: ToolRequest,
  instructions: string | undefined
): Promise<{ text: string; webSources: WebLookup }> {
  let question = instructions?.trim() || ""
  let documentTitle: string | null = null
  let libraryExcerpt: string | null = null
  if (request.messageId) {
    const loaded = await loadAnswer(ctx, request.messageId)
    question = question || loaded.question
    libraryExcerpt = loaded.answer
  }
  if (request.fileId) {
    const { data: file, error } = await ctx.supabase
      .from("files")
      .select("file_name")
      .eq("id", request.fileId)
      .eq("chatbot_id", ctx.chatbot.id)
      .maybeSingle()
    if (error) throw error
    if (!file) throw new HttpError(404, "Document not found in this assistant")
    documentTitle = file.file_name
    if (!question) question = `¿Hay una fuente oficial más reciente que «${file.file_name}»?`
  }
  if (!question) question = "¿Hay una fuente oficial más reciente?"
  const webSources = await searchNewerOfficialSource({
    question,
    documentTitle,
    libraryExcerpt,
  })
  return { text: webSources.note, webSources }
}

/** Runs a tool if the assistant allows it, and records the run. */
export async function runTool(
  ctx: ToolContext,
  request: ToolRequest
): Promise<{ tool: RunnableToolId; text: string; web_sources?: WebLookup }> {
  const enabled = normalizeTools(ctx.chatbot.enabled_tools)
  if (request.tool !== WEB_TOOL_ID && !enabled.includes(request.tool)) {
    throw new HttpError(403, "This tool is not enabled for this assistant")
  }
  const info = toolInfo(request.tool)
  if (request.tool === WEB_TOOL_ID) {
    if (!request.messageId && !request.fileId) {
      throw new HttpError(400, "messageId or fileId is required")
    }
  } else if (info.target === "answer" && !request.messageId) {
    throw new HttpError(400, "messageId is required")
  } else if (info.target === "document" && !request.fileId) {
    throw new HttpError(400, "fileId is required")
  }
  if ((await runsLastHour(ctx)) >= TOOL_HOURLY_LIMIT) {
    throw new HttpError(429, "Demasiadas herramientas en la última hora. Inténtalo más tarde.")
  }

  const instructions = request.instructions?.trim().slice(0, INSTRUCTIONS_MAX_LENGTH)
  const started = Date.now()
  let text = ""
  let webSources: WebLookup | undefined
  let failure: unknown = null
  try {
    const produced = await produce(ctx, request, instructions)
    text = produced.text
    webSources = produced.webSources
  } catch (error) {
    failure = error
  }

  const { error: logError } = await ctx.admin.from("tool_runs").insert({
    chatbot_id: ctx.chatbot.id,
    user_id: ctx.userId,
    tool: request.tool,
    status: failure ? "error" : "ok",
    input: {
      ...(request.messageId ? { messageId: request.messageId } : {}),
      ...(request.fileId ? { fileId: request.fileId } : {}),
      ...(instructions ? { instructions } : {}),
    },
    output_chars: text.length,
    duration_ms: Date.now() - started,
    error: failure ? String((failure as Error)?.message ?? failure).slice(0, 300) : null,
  })
  if (logError) console.error("tool_runs insert", logError)

  if (failure) throw failure
  return {
    tool: request.tool,
    text,
    ...(webSources ? { web_sources: webSources } : {}),
  }
}

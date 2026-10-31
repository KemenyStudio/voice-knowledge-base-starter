import { audienceFilter } from "@/lib/audience"
import { scrub, ToolError } from "@/lib/mcp/errors"
import { extractNumericSummary, groupSearchHits, toPublicDocument } from "@/lib/mcp/documents"
import type { PublicDocument, SearchPassage } from "@/lib/mcp/documents"
import { takeToken } from "@/lib/mcp/rate-limit"
import { runSearch } from "@/lib/research"
import { getAdminClient } from "@/lib/supabase/server"
import type { AnySupabase } from "@/lib/supabase/server"
import type { FileRow } from "@/types/knowledge"

const SEARCHES_PER_MINUTE = 30
const LIST_DEFAULT = 50
const FILE_PAGE = 1000
const FILE_CAP = 5000
const FEEDBACK_CAP = 5000

export interface AssistantSummary {
  id: string
  name: string
  description: string | null
  documentCount: number
}

interface AssistantRow {
  id: string
  name: string
  description: string | null
  team_id: string
  vector_store_id: string | null
}

export interface FeedbackSummary {
  assistants: Array<{ id: string; name: string }>
  answerRatings: {
    total: number
    positive: number
    negative: number
    open: number
    resolved: number
    answers: number
    answersWithoutSources: number
  }
  evaluations: Array<{
    evaluationSet: string
    positive: number
    negative: number
    votes: number
    /** Numeric summary from evaluation_results, when this team has votes on the set. */
    results: Record<string, number> | null
    evaluatedAt: string | null
  }>
  truncated: boolean
}

function fail(error: { message?: string } | null, fallback: string): never {
  console.error("[mcp]", scrub(error?.message || fallback))
  throw new ToolError(fallback)
}

async function assistants(admin: AnySupabase, teamId: string): Promise<AssistantRow[]> {
  const { data, error } = await admin
    .from("chatbots")
    .select("id, name, description, team_id, vector_store_id")
    .eq("team_id", teamId)
    .order("name", { ascending: true })
  if (error) fail(error, "No se pudieron leer los asistentes")
  return (data ?? []) as AssistantRow[]
}

async function resolveAssistant(
  admin: AnySupabase,
  teamId: string,
  assistantId: string | undefined
): Promise<AssistantRow> {
  const rows = await assistants(admin, teamId)
  if (assistantId) {
    const found = rows.find((row) => row.id === assistantId)
    if (!found) throw new ToolError("Ese asistente no pertenece a este equipo")
    return found
  }
  if (rows.length === 1) return rows[0]
  if (rows.length === 0) throw new ToolError("Este equipo no tiene asistentes")
  const choices = rows.map((row) => `${row.name} (${row.id})`).join(", ")
  throw new ToolError(`Indica assistantId. Asistentes: ${choices}`)
}

async function countFiles(admin: AnySupabase, chatbotId: string): Promise<number> {
  const { count, error } = await admin
    .from("files")
    .select("id", { count: "exact", head: true })
    .eq("chatbot_id", chatbotId)
  if (error) fail(error, "No se pudieron contar los documentos")
  return count ?? 0
}

export async function listAssistants(teamId: string): Promise<AssistantSummary[]> {
  const admin = getAdminClient()
  const rows = await assistants(admin, teamId)
  return Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      documentCount: await countFiles(admin, row.id),
    }))
  )
}

export async function listDocuments(input: {
  teamId: string
  assistantId?: string
  name?: string
  limit?: number
  offset?: number
}): Promise<{ documents: PublicDocument[]; total: number; limit: number; offset: number }> {
  const admin = getAdminClient()
  const assistant = await resolveAssistant(admin, input.teamId, input.assistantId)
  const limit = input.limit ?? LIST_DEFAULT
  const offset = input.offset ?? 0
  let query = admin
    .from("files")
    .select("*", { count: "exact" })
    .eq("chatbot_id", assistant.id)
    .order("uploaded_at", { ascending: false })
    .range(offset, offset + limit - 1)
  if (input.name) {
    query = query.ilike("file_name", `%${escapeLike(input.name)}%`)
  }
  const { data, error, count } = await query
  if (error) fail(error, "No se pudieron listar los documentos")
  return {
    documents: ((data ?? []) as FileRow[]).map(toPublicDocument),
    total: count ?? 0,
    limit,
    offset,
  }
}

export async function getDocument(teamId: string, documentId: string): Promise<PublicDocument> {
  const admin = getAdminClient()
  const { data, error } = await admin.from("files").select("*").eq("id", documentId).maybeSingle()
  if (error) fail(error, "No se pudo leer el documento")
  if (!data) throw new ToolError("Documento no encontrado")
  const row = data as FileRow
  const { data: assistant, error: assistantError } = await admin
    .from("chatbots")
    .select("id, team_id")
    .eq("id", row.chatbot_id)
    .maybeSingle()
  if (assistantError) fail(assistantError, "No se pudo leer el documento")
  if (!assistant || String(assistant.team_id).toLowerCase() !== teamId) {
    throw new ToolError("Documento no encontrado")
  }
  return toPublicDocument(row)
}

export async function searchLibrary(input: {
  teamId: string
  query: string
  assistantId?: string
  entityType?: string
  maxResults?: number
}): Promise<{ assistantId: string; query: string; results: SearchPassage[] }> {
  if (!takeToken(`search:${input.teamId}`, SEARCHES_PER_MINUTE, 60_000)) {
    throw new ToolError("Demasiadas búsquedas. Espera un minuto.")
  }
  const admin = getAdminClient()
  const assistant = await resolveAssistant(admin, input.teamId, input.assistantId)
  if (!assistant.vector_store_id) {
    throw new ToolError("Este asistente no tiene documentos indexados")
  }
  const maxResults = input.maxResults ?? 8
  let hits
  try {
    hits = await runSearch({
      vectorStoreId: assistant.vector_store_id,
      query: input.query,
      filter: input.entityType ? audienceFilter(input.entityType) : null,
    })
  } catch (error) {
    console.error("[mcp] search", scrub(error instanceof Error ? error.message : "search failed"))
    throw new ToolError("No se pudo buscar en la biblioteca")
  }
  const index = await documentIndex(admin, assistant.id)
  return {
    assistantId: assistant.id,
    query: input.query,
    results: groupSearchHits(
      hits.map((hit) => ({
        openaiFileId: hit.file_id,
        filename: hit.filename,
        score: hit.score,
        text: hit.text,
        fileRowId:
          typeof hit.attributes.file_row_id === "string" ? hit.attributes.file_row_id : null,
      })),
      index.known,
      index.openaiToId,
      maxResults
    ),
  }
}

async function documentIndex(admin: AnySupabase, chatbotId: string) {
  const known = new Set<string>()
  const openaiToId = new Map<string, string>()
  for (let from = 0; from < FILE_CAP; from += FILE_PAGE) {
    const { data, error } = await admin
      .from("files")
      .select("id, openai_file_id")
      .eq("chatbot_id", chatbotId)
      .range(from, from + FILE_PAGE - 1)
    if (error) fail(error, "No se pudieron leer los documentos")
    const rows = (data ?? []) as Array<{ id: string; openai_file_id: string | null }>
    for (const row of rows) {
      known.add(row.id)
      if (row.openai_file_id) openaiToId.set(row.openai_file_id, row.id)
    }
    if (rows.length < FILE_PAGE) break
  }
  return { known, openaiToId }
}

export async function feedbackSummary(input: {
  teamId: string
  evaluationSet?: string
}): Promise<FeedbackSummary> {
  const admin = getAdminClient()
  const rows = await assistants(admin, input.teamId)
  const ids = rows.map((row) => row.id)
  const emptyRatings = {
    total: 0,
    positive: 0,
    negative: 0,
    open: 0,
    resolved: 0,
    answers: 0,
    answersWithoutSources: 0,
  }
  if (ids.length === 0) {
    return {
      assistants: [],
      answerRatings: emptyRatings,
      evaluations: [],
      truncated: false,
    }
  }

  const ratings = await countRatings(admin, ids)
  const { evaluations, truncated } = await evaluationVotes(admin, ids, input.evaluationSet)
  return {
    assistants: rows.map((row) => ({ id: row.id, name: row.name })),
    answerRatings: ratings,
    evaluations,
    truncated,
  }
}

async function countRatings(admin: AnySupabase, chatbotIds: string[]) {
  const countWhere = async (column: string, value: string | number) => {
    const { count, error } = await admin
      .from("answer_ratings")
      .select("message_id, chat_messages!inner(chatbot_id)", { count: "exact", head: true })
      .in("chat_messages.chatbot_id", chatbotIds)
      .eq(column, value)
    if (error) fail(error, "No se pudo leer el resumen de calificaciones")
    return count ?? 0
  }
  const { count: total, error } = await admin
    .from("answer_ratings")
    .select("message_id, chat_messages!inner(chatbot_id)", { count: "exact", head: true })
    .in("chat_messages.chatbot_id", chatbotIds)
  if (error) fail(error, "No se pudo leer el resumen de calificaciones")
  const answersQuery = () =>
    admin.from("chat_messages").select("id", { count: "exact", head: true }).in("chatbot_id", chatbotIds).eq("role", "assistant")
  const [positive, negative, open, resolved, answersResult, bareResult] = await Promise.all([
    countWhere("rating", 1),
    countWhere("rating", -1),
    countWhere("triage_status", "open"),
    countWhere("triage_status", "resolved"),
    answersQuery(),
    answersQuery().filter("citations", "eq", "[]"),
  ])
  if (answersResult.error) fail(answersResult.error, "No se pudo leer el resumen de calificaciones")
  if (bareResult.error) fail(bareResult.error, "No se pudo leer el resumen de calificaciones")
  return {
    total: total ?? 0,
    positive,
    negative,
    open,
    resolved,
    answers: answersResult.count ?? 0,
    answersWithoutSources: bareResult.count ?? 0,
  }
}

async function evaluationVotes(
  admin: AnySupabase,
  chatbotIds: string[],
  evaluationSet: string | undefined
) {
  let query = admin
    .from("feedback")
    .select("evaluation_set, is_positive")
    .in("chatbot_id", chatbotIds)
    .limit(FEEDBACK_CAP)
  if (evaluationSet) query = query.eq("evaluation_set", evaluationSet)
  const { data, error } = await query
  if (error) fail(error, "No se pudo leer el resumen de evaluaciones")
  const votes = (data ?? []) as Array<{ evaluation_set: string; is_positive: boolean | null }>
  const truncated = votes.length >= FEEDBACK_CAP
  const bySet = new Map<string, { positive: number; negative: number }>()
  for (const vote of votes) {
    const current = bySet.get(vote.evaluation_set) ?? { positive: 0, negative: 0 }
    if (vote.is_positive) current.positive += 1
    else current.negative += 1
    bySet.set(vote.evaluation_set, current)
  }

  const sets = Array.from(bySet.keys())
  const resultsBySet = new Map<string, { results: Record<string, number> | null; evaluatedAt: string | null }>()
  if (sets.length > 0) {
    const { data: stored, error: storedError } = await admin
      .from("evaluation_results")
      .select("evaluation_set, timestamp, data")
      .in("evaluation_set", sets)
    if (storedError) fail(storedError, "No se pudo leer el resumen de evaluaciones")
    for (const row of (stored ?? []) as Array<{
      evaluation_set: string
      timestamp: string | null
      data: string | null
    }>) {
      resultsBySet.set(row.evaluation_set, {
        results: extractNumericSummary(row.data),
        evaluatedAt: row.timestamp,
      })
    }
  }

  const evaluations = sets
    .sort()
    .map((set) => {
      const counts = bySet.get(set) ?? { positive: 0, negative: 0 }
      const stored = resultsBySet.get(set)
      return {
        evaluationSet: set,
        positive: counts.positive,
        negative: counts.negative,
        votes: counts.positive + counts.negative,
        results: stored?.results ?? null,
        evaluatedAt: stored?.evaluatedAt ?? null,
      }
    })
  return { evaluations, truncated }
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`)
}

import { buildHealthReport } from "@/lib/knowledge/health"
import { getAdminClient, type AnySupabase } from "@/lib/supabase/server"
import type { AudienceStatus, FileMetadata, FileRow, SyncStatus, TeamRole } from "@/types/knowledge"
import {
  excerpt,
  speakFeedback,
  speakLibraryCounts,
  speakMemberCount,
  speakQuestions,
  type AppDatum,
} from "@/lib/voice/app-speech"

export type { AppDatum } from "@/lib/voice/app-speech"

const QUESTION_LIMIT = 5

async function countRows(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>
) {
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

/** Member count for this team. Admins also get the admin/member split. No emails. */
export async function readMemberCount(
  supabase: AnySupabase,
  teamId: string,
  role: TeamRole
): Promise<string> {
  const { data, error } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
  if (error) throw error
  const rows = data ?? []
  const admins = rows.filter((row) => row.role === "admin").length
  return speakMemberCount({
    total: rows.length,
    admins: role === "admin" ? admins : null,
  })
}

/** Recent questions. Members only see their own. Admins see team excerpts, not whole threads. */
export async function readRecentQuestions(
  supabase: AnySupabase,
  chatbotId: string,
  userId: string,
  role: TeamRole
): Promise<string> {
  const client = role === "admin" ? getAdminClient() : supabase
  let listQuery = client
    .from("chat_messages")
    .select("content")
    .eq("chatbot_id", chatbotId)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(QUESTION_LIMIT)
  let countQuery = client
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("chatbot_id", chatbotId)
    .eq("role", "user")
  if (role !== "admin") {
    listQuery = listQuery.eq("user_id", userId)
    countQuery = countQuery.eq("user_id", userId)
  }
  const [total, listed] = await Promise.all([
    countRows(countQuery),
    listQuery,
  ])
  if (listed.error) throw listed.error
  return speakQuestions({
    total,
    scope: role === "admin" ? "team" : "own",
    items: (listed.data ?? []).map((row) => excerpt(String(row.content ?? ""))),
  })
}

/** Ratings, low ratings, and answers stored with no sources. Scoped to what this role can see. */
export async function readFeedbackSummary(
  supabase: AnySupabase,
  chatbotId: string,
  userId: string,
  role: TeamRole
): Promise<string> {
  const client = role === "admin" ? getAdminClient() : supabase
  const ratings = () => {
    let query = client
      .from("answer_ratings")
      .select("message_id, chat_messages!inner(chatbot_id)", { count: "exact", head: true })
      .eq("chat_messages.chatbot_id", chatbotId)
    if (role !== "admin") query = query.eq("user_id", userId)
    return query
  }
  const answers = () => {
    let query = client
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("chatbot_id", chatbotId)
      .eq("role", "assistant")
      .filter("citations", "eq", "[]")
    if (role !== "admin") query = query.eq("user_id", userId)
    return query
  }
  const [total, low, withoutSources] = await Promise.all([
    countRows(ratings()),
    countRows(ratings().eq("rating", -1)),
    countRows(answers()),
  ])
  return speakFeedback({
    ratings: total,
    low,
    withoutSources,
    scope: role === "admin" ? "team" : "own",
  })
}

/** Document counts from rows this member can read. No chunk or score figures. */
export async function readLibraryCounts(
  supabase: AnySupabase,
  chatbotId: string
): Promise<string> {
  const { data, error } = await supabase
    .from("files")
    .select(
      "id, file_name, uploaded_at, sync_status, sync_error, openai_file_id, vector_store_id, blob_name, audience_status, metadata, outdated, outdated_note"
    )
    .eq("chatbot_id", chatbotId)
  if (error) throw error
  const files: FileRow[] = (data ?? []).map((row) => ({
    id: String(row.id),
    chatbot_id: chatbotId,
    file_name: String(row.file_name ?? "Documento"),
    file_type: null,
    file_url: "",
    uploaded_at: String(row.uploaded_at ?? new Date(0).toISOString()),
    metadata: asFileMetadata(row.metadata),
    blob_name: row.blob_name,
    openai_file_id: row.openai_file_id,
    vector_store_id: row.vector_store_id,
    sync_status: asSyncStatus(row.sync_status),
    sync_error: row.sync_error,
    size_bytes: null,
    uploaded_by: null,
    audience: [],
    audience_suggested: [],
    audience_status: asAudienceStatus(row.audience_status),
    outdated: Boolean(row.outdated),
    outdated_note: row.outdated_note,
    superseded_by: null,
    index_health_score: null,
    index_health: null,
  }))
  const report = buildHealthReport(files, { audienceEnabled: true })
  const attention = Math.max(0, report.totals.documents - report.totals.ready)
  return speakLibraryCounts({
    documents: report.totals.documents,
    ready: report.totals.ready,
    attention,
    missingLabels: report.untaggedAudience,
  })
}

function asSyncStatus(value: string | null): SyncStatus {
  switch (value) {
    case "pending":
    case "processing":
    case "ready":
    case "failed":
    case "external":
      return value
    default:
      return "pending"
  }
}

function asAudienceStatus(value: string | null): AudienceStatus {
  switch (value) {
    case "unclassified":
    case "suggested":
    case "confirmed":
      return value
    default:
      return "unclassified"
  }
}

function asFileMetadata(value: unknown): Partial<FileMetadata> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const record = value as Record<string, unknown>
  const metadata: Partial<FileMetadata> = {}
  if (typeof record.type_tag === "string") metadata.type_tag = record.type_tag
  if (Array.isArray(record.target_tag)) {
    metadata.target_tag = record.target_tag.filter((item): item is string => typeof item === "string")
  }
  if (Array.isArray(record.entity_tag)) {
    metadata.entity_tag = record.entity_tag.filter((item): item is string => typeof item === "string")
  }
  return metadata
}

import { v4 as uuidv4 } from "uuid"

import { readLocation, type PassageContext } from "@/lib/chat/passage"
import { sessionHeading } from "@/lib/chat/session-title"
import { HttpError } from "@/lib/http"
import type { AnySupabase } from "@/lib/supabase/server"
import type { WebLookup } from "@/lib/web-search"
import type { CitationLocation } from "@/types/knowledge"

export { cleanSessionTitle, sessionHeading, titleFrom } from "@/lib/chat/session-title"

/**
 * Chat history in Supabase (`chat_messages`). Every function takes the
 * user-scoped client, so RLS (own rows only, team members only) applies on top
 * of the explicit user/chatbot filters below.
 */

export interface StoredMessage {
  id: string
  message: string
  role: "user" | "assistant"
  title: string | null
  createdAt: string
  meta: MessageMeta
}

interface MessageRow {
  id: string
  content: string
  role: "user" | "assistant"
  title: string | null
  created_at: string
  meta: MessageMeta | null
}

/** Most recent messages of one session, oldest first. */
export async function getRecentMessages(
  supabase: AnySupabase,
  userId: string,
  sessionId: string,
  chatbotId: string,
  limit = 15
): Promise<StoredMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, content, role, title, created_at, meta")
    .eq("user_id", userId)
    .eq("chatbot_id", chatbotId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error) throw error

  return ((data ?? []) as MessageRow[]).reverse().map((row) => ({
    id: row.id,
    message: row.content,
    role: row.role,
    title: row.title,
    createdAt: row.created_at,
    meta: row.meta ?? {},
  }))
}

/**
 * Id of the last OpenAI response of this session. The server derives it from
 * its own history so a stale or foreign id sent by the browser is never used.
 */
export function lastResponseId(messages: StoredMessage[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m.role === "assistant" && m.id.startsWith("resp_")) return m.id
  }
  return null
}

export async function storeMessage(
  supabase: AnySupabase,
  input: {
    id?: string
    message: string
    userId: string
    sessionId: string
    chatbotId: string
    role: "user" | "assistant"
    title: string
    citations?: StoredCitation[]
    meta?: MessageMeta
  }
): Promise<void> {
  const { error } = await supabase.from("chat_messages").insert({
    id: input.id ?? uuidv4(),
    user_id: input.userId,
    chatbot_id: input.chatbotId,
    session_id: input.sessionId,
    role: input.role,
    content: input.message,
    title: input.title,
    citations: input.citations ?? [],
    meta: input.meta ?? {},
  })
  if (error) throw error
}

/** Citation as persisted with an assistant message. */
export interface StoredCitation {
  number: number
  title: string
  url: string | null
  /** Best passage of the document, so reopened conversations keep their sources. */
  text?: string
  outdated?: boolean
  /** Page, article, or in-file location copied from the citation metadata. */
  location?: CitationLocation
}

/** Extras persisted with an assistant message. */
export interface MessageMeta {
  follow_ups?: string[]
  clarify?: { question: string; options: string[]; kind?: "entity_type" }
  entity_filter?: { applied: boolean; entity: string | null }
  /** Web hits for “is there a newer official source”. Not library citations. */
  web_sources?: WebLookup
  /** Passage the user attached with "Preguntar sobre esto". */
  passage?: PassageContext
  [key: string]: unknown
}

/** Merges `patch` into the meta of one of the user's own messages. */
export async function updateMessageMeta(
  admin: AnySupabase,
  input: { id: string; userId: string; patch: MessageMeta }
): Promise<void> {
  const { data, error } = await admin
    .from("chat_messages")
    .select("meta")
    .eq("id", input.id)
    .eq("user_id", input.userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return
  const { error: updateError } = await admin
    .from("chat_messages")
    .update({ meta: { ...(data.meta ?? {}), ...input.patch } })
    .eq("id", input.id)
    .eq("user_id", input.userId)
  if (updateError) throw updateError
}

export interface SessionSummary {
  session: string
  message: string
  /** Unix seconds of the last activity (what the UI expects). */
  createdAt: number
  title: string
}

interface SessionRow {
  session_id: string
  title: string | null
  last_message: string | null
  last_activity: string
}

function toSummary(row: SessionRow): SessionSummary {
  const message = row.last_message ?? ""
  return {
    session: row.session_id,
    message,
    createdAt: Math.floor(new Date(row.last_activity).getTime() / 1000),
    title: sessionHeading(row.title, message),
  }
}

/** One entry per conversation, newest first. The database returns at most 200. */
export async function listSessions(
  supabase: AnySupabase,
  chatbotId: string
): Promise<SessionSummary[]> {
  const { data, error } = await supabase.rpc("list_chat_sessions", {
    p_chatbot_id: chatbotId,
  })
  if (error) throw error
  return ((data ?? []) as SessionRow[]).map(toSummary)
}

/**
 * Conversations whose question, answer or title contains `query`.
 * Looks past the 200-row list. The query is matched literally.
 */
export async function searchSessions(
  supabase: AnySupabase,
  chatbotId: string,
  query: string
): Promise<SessionSummary[]> {
  const { data, error } = await supabase.rpc("search_chat_sessions", {
    p_chatbot_id: chatbotId,
    p_query: query,
  })
  if (error) throw error
  return ((data ?? []) as SessionRow[]).map(toSummary)
}

/** Sets the title on the caller's messages in one conversation. Returns rows updated. */
export async function renameSession(
  supabase: AnySupabase,
  chatbotId: string,
  sessionId: string,
  title: string
): Promise<number> {
  const { data, error } = await supabase.rpc("rename_chat_session", {
    p_chatbot_id: chatbotId,
    p_session_id: sessionId,
    p_title: title,
  })
  if (error) {
    if ((error.message ?? "").includes("invalid title")) {
      throw new HttpError(400, "El título debe tener entre 1 y 120 caracteres.")
    }
    throw error
  }
  const updated = Number(data)
  return Number.isFinite(updated) ? updated : 0
}

/** Deletes the caller's messages in one conversation. Shared links are copies and stay. */
export async function deleteSession(
  supabase: AnySupabase,
  userId: string,
  chatbotId: string,
  sessionId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("chat_messages")
    .delete()
    .eq("user_id", userId)
    .eq("chatbot_id", chatbotId)
    .eq("session_id", sessionId)
    .select("id")
  if (error) throw error
  return Array.isArray(data) ? data.length : 0
}

export interface TranscriptMessage {
  id: string
  role: "user" | "assistant"
  content: string
  pinned: boolean
  folder: string | null
  citations: Array<{
    number: number
    file_id: string
    filename: string
    title: string
    text: string
    score: number
    attributes: Record<string, string | number | boolean>
    file_url: string | null
  }>
  meta: MessageMeta
}

/** Full transcript of a session in the shape the chat UI expects. */
export async function getSessionTranscript(
  supabase: AnySupabase,
  userId: string,
  sessionId: string,
  chatbotId: string
): Promise<TranscriptMessage[]> {
  const { data, error } = await supabase
    .from("chat_messages")
    .select("id, role, content, citations, meta, pinned, folder")
    .eq("user_id", userId)
    .eq("chatbot_id", chatbotId)
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
  if (error) throw error

  return ((data ?? []) as Array<{
    id: string
    role: "user" | "assistant"
    content: string
    citations: StoredCitation[] | null
    meta: MessageMeta | null
    pinned: boolean | null
    folder: string | null
  }>).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    pinned: Boolean(row.pinned),
    folder: row.folder,
    citations: (row.citations ?? []).map((c) => ({
      number: c.number,
      file_id: "",
      filename: "",
      title: c.title,
      text: c.text ?? "",
      score: 0,
      attributes: {},
      file_url: c.url ?? null,
      outdated: c.outdated,
      location: readLocation(c.location),
    })),
    meta: row.meta ?? {},
  }))
}

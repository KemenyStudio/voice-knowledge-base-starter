import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { parseUuid, requireChatbotAccess } from "@/lib/auth/access"
import { sendEmail } from "@/lib/emails"
import { feedbackResolvedTemplate } from "@/lib/emails/templates/feedback-resolved"
import { HttpError, errorResponse } from "@/lib/http"
import {
  MAX_PROMPT_NOTES,
  PROMPT_NOTE_MAX_LENGTH,
  normalizeNotes,
} from "@/lib/prompt-notes"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const MAX_ITEMS = 200

interface AnswerRef {
  id: string
  session_id: string
  content: string
}

interface StoredCitationRow {
  title?: string
  url?: string | null
}

interface RatingRow {
  message_id: string
  user_id: string
  rating: number
  comment: string | null
  created_at: string
  triage_status: string
  triage_action: string | null
  triage_note: string | null
  // Embedded relation: an object (many-to-one), typed loosely for PostgREST.
  chat_messages:
    | (AnswerRef & { chatbot_id: string; citations: StoredCitationRow[] | null })
    | Array<AnswerRef & { chatbot_id: string; citations: StoredCitationRow[] | null }>
}

const FILE_URL = /^\/api\/files\/([0-9a-f-]{36})\/download/i

/**
 * Feedback left on answers in the assistants of the teams the caller
 * administers, with the sources each answer used and what was done about it.
 */
export async function GET() {
  try {
    const { user } = await requireUser()
    const admin = getAdminClient()

    const { data: adminships, error: adminError } = await admin
      .from("team_members")
      .select("team_id")
      .eq("user_id", user.id)
      .eq("role", "admin")
    if (adminError) throw adminError
    const teamIds = (adminships ?? []).map((row: { team_id: string }) => row.team_id)
    if (teamIds.length === 0) {
      throw new HttpError(403, "Only team admins can view feedback")
    }

    const { data: chatbots, error: chatbotsError } = await admin
      .from("chatbots")
      .select("id, name")
      .in("team_id", teamIds)
    if (chatbotsError) throw chatbotsError
    const nameById = new Map<string, string>(
      (chatbots ?? []).map((row: { id: string; name: string }) => [row.id, row.name])
    )
    const chatbotIds = Array.from(nameById.keys())
    if (chatbotIds.length === 0) {
      return NextResponse.json({ items: [], summary: EMPTY_SUMMARY, unsourced: [] }, { status: 200 })
    }

    const [{ data, error }, summary, unsourcedRows] = await Promise.all([
      admin
        .from("answer_ratings")
        .select(
          "message_id, user_id, rating, comment, created_at, triage_status, triage_action, triage_note, chat_messages!inner(id, session_id, content, chatbot_id, citations)"
        )
        .in("chat_messages.chatbot_id", chatbotIds)
        .order("created_at", { ascending: false })
        .limit(MAX_ITEMS),
      loadSummary(admin, chatbotIds).catch((summaryError) => {
        console.error("GET /api/response_feedback summary", summaryError)
        return EMPTY_SUMMARY
      }),
      loadUnsourced(admin, chatbotIds).catch((unsourcedError) => {
        console.error("GET /api/response_feedback unsourced", unsourcedError)
        return { total: 0, rows: [] as BareAnswer[] }
      }),
    ])
    if (error) throw error

    const ratings = ((data ?? []) as RatingRow[]).map((row) => ({
      ...row,
      answer: Array.isArray(row.chat_messages)
        ? row.chat_messages[0]
        : row.chat_messages,
    }))
    const sessions = Array.from(
      new Set([
        ...ratings.map((r) => r.answer.session_id),
        ...unsourcedRows.rows.map((row) => row.session_id),
      ])
    )
    const userIds = Array.from(
      new Set([
        ...ratings.map((r) => r.user_id),
        ...unsourcedRows.rows.map((row) => row.user_id),
      ])
    )
    const [{ data: sessionMessages }, { data: profiles }] =
      sessions.length === 0
        ? [{ data: [] }, { data: [] }]
        : await Promise.all([
            admin
              .from("chat_messages")
              .select("id, session_id, role, content")
              .in("chatbot_id", chatbotIds)
              .in("session_id", sessions)
              .order("created_at", { ascending: true }),
            userIds.length === 0
              ? Promise.resolve({ data: [] as { id: string; email: string }[] })
              : admin.from("profiles").select("id, email").in("id", userIds),
          ])

    const emailById = new Map<string, string>(
      (profiles ?? []).map((p: { id: string; email: string }) => [p.id, p.email])
    )
    const bySession = new Map<string, Array<AnswerRef & { role?: string }>>()
    for (const message of (sessionMessages ?? []) as Array<AnswerRef & { role?: string }>) {
      const list = bySession.get(message.session_id) ?? []
      list.push(message)
      bySession.set(message.session_id, list)
    }

    const items = ratings.map((rating) => {
      const thread = bySession.get(rating.answer.session_id) ?? []
      const index = thread.findIndex((m) => m.id === rating.answer.id)
      const sources = (rating.answer.citations ?? []).map((c) => ({
        title: c.title ?? "Documento",
        fileId: c.url?.match(FILE_URL)?.[1] ?? null,
      }))
      return {
        id: rating.message_id,
        userId: rating.user_id,
        userEmail: emailById.get(rating.user_id),
        chatbotId: rating.answer.chatbot_id,
        chatbotName: nameById.get(rating.answer.chatbot_id) ?? "",
        rating: rating.rating,
        comment: rating.comment ?? "",
        question: index > 0 ? thread[index - 1]?.content : undefined,
        response: rating.answer.content,
        sources,
        triage: {
          status: rating.triage_status,
          action: rating.triage_action,
          note: rating.triage_note,
        },
        timestamp: Math.floor(new Date(rating.created_at).getTime() / 1000),
      }
    })

    const unsourced = unsourcedRows.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userEmail: emailById.get(row.user_id) ?? "",
      chatbotId: row.chatbot_id,
      chatbotName: nameById.get(row.chatbot_id) ?? "",
      question: previousQuestion(bySession.get(row.session_id) ?? [], row.id),
      response: row.content,
      timestamp: Math.floor(new Date(row.created_at).getTime() / 1000),
    }))

    return NextResponse.json(
      { items, summary: { ...summary, answersWithoutSources: unsourcedRows.total }, unsourced },
      { status: 200 }
    )
  } catch (error) {
    return errorResponse(error, "GET /api/response_feedback")
  }
}

const EMPTY_SUMMARY = {
  ratings: 0,
  positive: 0,
  low: 0,
  open: 0,
  ratedWithoutSources: 0,
  answers: 0,
  answersWithoutSources: 0,
}

async function countRows(
  query: PromiseLike<{ count: number | null; error: { message: string } | null }>
) {
  const { count, error } = await query
  if (error) throw error
  return count ?? 0
}

/** Totals for the admin overview. Counts are not limited to the row window. */
async function loadSummary(
  admin: ReturnType<typeof getAdminClient>,
  chatbotIds: string[]
) {
  const ratings = () =>
    admin
      .from("answer_ratings")
      .select("message_id, chat_messages!inner(chatbot_id)", { count: "exact", head: true })
      .in("chat_messages.chatbot_id", chatbotIds)
  const answers = () =>
    admin
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .in("chatbot_id", chatbotIds)
      .eq("role", "assistant")

  const [total, positive, low, open, cited, answerTotal] = await Promise.all([
    countRows(ratings()),
    countRows(ratings().eq("rating", 1)),
    countRows(ratings().eq("rating", -1)),
    countRows(ratings().eq("triage_status", "open")),
    admin
      .from("answer_ratings")
      .select("message_id, chat_messages!inner(citations)")
      .in("chat_messages.chatbot_id", chatbotIds)
      .limit(1000),
    countRows(answers()),
  ])
  if (cited.error) throw cited.error
  const ratedWithoutSources = ((cited.data ?? []) as Array<{
    chat_messages:
      | { citations: unknown[] | null }
      | Array<{ citations: unknown[] | null }>
  }>).filter((row) => {
    const message = Array.isArray(row.chat_messages) ? row.chat_messages[0] : row.chat_messages
    return !message?.citations || message.citations.length === 0
  }).length

  return {
    ratings: total,
    positive,
    low,
    open,
    ratedWithoutSources,
    answers: answerTotal,
    answersWithoutSources: 0,
  }
}

interface BareAnswer {
  id: string
  user_id: string
  chatbot_id: string
  session_id: string
  content: string
  created_at: string
}

/** Latest assistant answers stored with an empty citation list. */
async function loadUnsourced(
  admin: ReturnType<typeof getAdminClient>,
  chatbotIds: string[]
): Promise<{ total: number; rows: BareAnswer[] }> {
  const { data, count, error } = await admin
    .from("chat_messages")
    .select("id, user_id, chatbot_id, session_id, content, created_at", { count: "exact" })
    .in("chatbot_id", chatbotIds)
    .eq("role", "assistant")
    .filter("citations", "eq", "[]")
    .order("created_at", { ascending: false })
    .limit(25)
  if (error) throw error
  return { total: count ?? 0, rows: (data ?? []) as BareAnswer[] }
}

function previousQuestion(
  thread: Array<AnswerRef & { role?: string }>,
  answerId: string
) {
  const index = thread.findIndex((message) => message.id === answerId)
  for (let i = index - 1; i >= 0; i--) {
    if (thread[i]?.role === "user") return thread[i]?.content
  }
  return index > 0 ? thread[index - 1]?.content : undefined
}

const triageSchema = z.object({
  messageId: z.string().min(1).max(200),
  userId: z.string().uuid(),
  action: z.enum([
    "outdated_document",
    "prompt_note",
    "request_document",
    "dismiss",
    "resolve",
    "reopen",
  ]),
  fileId: z.string().uuid().optional(),
  note: z.string().trim().max(PROMPT_NOTE_MAX_LENGTH).optional(),
  /** Opt-in: e-mail the person who rated, with `userMessage`. Never sent unless true. */
  notifyUser: z.boolean().optional(),
  userMessage: z.string().trim().max(500).optional(),
})

/**
 * Does something about a rating (team admins): flag a document as outdated,
 * add a note to the assistant's instructions, request a missing document, or
 * close/reopen the item.
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = triageSchema.parse(await req.json())
    const admin = getAdminClient()

    const { data: message, error: messageError } = await admin
      .from("chat_messages")
      .select("id, chatbot_id, session_id, created_at")
      .eq("id", body.messageId)
      .eq("role", "assistant")
      .maybeSingle()
    if (messageError) throw messageError
    if (!message) throw new HttpError(404, "Answer not found")

    const { chatbot } = await requireChatbotAccess(
      supabase,
      user.id,
      parseUuid(message.chatbot_id),
      "admin"
    )

    const { data: rating, error: ratingError } = await admin
      .from("answer_ratings")
      .select("message_id, user_id")
      .eq("message_id", body.messageId)
      .eq("user_id", body.userId)
      .maybeSingle()
    if (ratingError) throw ratingError
    if (!rating) throw new HttpError(404, "Rating not found")

    const patch: Record<string, unknown> = {
      triaged_by: user.id,
      triaged_at: new Date().toISOString(),
    }

    switch (body.action) {
      case "outdated_document": {
        if (!body.fileId) throw new HttpError(400, "Choose the document")
        const { data: file } = await admin
          .from("files")
          .select("id")
          .eq("id", body.fileId)
          .eq("chatbot_id", chatbot.id)
          .maybeSingle()
        if (!file) throw new HttpError(404, "Document not found in this assistant")
        const { error } = await admin
          .from("files")
          .update({ outdated: true, outdated_note: body.note || null })
          .eq("id", file.id)
        if (error) throw error
        Object.assign(patch, {
          triage_status: "resolved",
          triage_action: "outdated_document",
          triage_file_id: file.id,
          triage_note: body.note || null,
        })
        break
      }
      case "prompt_note": {
        if (!body.note) throw new HttpError(400, "Write the note")
        const notes = normalizeNotes(chatbot.prompt_notes)
        if (notes.length >= MAX_PROMPT_NOTES) {
          throw new HttpError(
            409,
            `The assistant already has ${MAX_PROMPT_NOTES} notes. Remove one in "Asistente" first.`
          )
        }
        const { error } = await admin
          .from("chatbots")
          .update({ prompt_notes: [...notes, body.note] })
          .eq("id", chatbot.id)
        if (error) throw error
        Object.assign(patch, {
          triage_status: "resolved",
          triage_action: "prompt_note",
          triage_note: body.note,
        })
        break
      }
      case "request_document":
        if (!body.note) throw new HttpError(400, "Say which document is missing")
        Object.assign(patch, {
          triage_status: "open",
          triage_action: "request_document",
          triage_note: body.note,
        })
        break
      case "dismiss":
        Object.assign(patch, {
          triage_status: "resolved",
          triage_action: "dismissed",
          triage_note: body.note || null,
        })
        break
      case "resolve":
        Object.assign(patch, { triage_status: "resolved" })
        break
      case "reopen":
        Object.assign(patch, {
          triage_status: "open",
          triage_action: null,
          triage_note: null,
          triage_file_id: null,
        })
        break
    }

    const { error: updateError } = await admin
      .from("answer_ratings")
      .update(patch)
      .eq("message_id", body.messageId)
      .eq("user_id", body.userId)
    if (updateError) throw updateError

    let emailed = false
    if (body.notifyUser && body.userMessage && body.action !== "reopen") {
      const { data: profile } = await admin
        .from("profiles")
        .select("email")
        .eq("id", body.userId)
        .maybeSingle()
      if (profile?.email) {
        const { data: question } = await admin
          .from("chat_messages")
          .select("content")
          .eq("chatbot_id", chatbot.id)
          .eq("session_id", message.session_id)
          .eq("role", "user")
          .lt("created_at", message.created_at)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle()
        const mail = feedbackResolvedTemplate({
          assistantName: chatbot.name,
          question: question?.content,
          message: body.userMessage,
        })
        const result = await sendEmail({ to: profile.email, ...mail })
        emailed = result.success
      }
    }

    return NextResponse.json({ success: true, emailed })
  } catch (error) {
    return errorResponse(error, "POST /api/response_feedback")
  }
}

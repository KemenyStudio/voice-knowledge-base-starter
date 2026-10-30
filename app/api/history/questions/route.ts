import { NextRequest, NextResponse } from "next/server"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const LIMIT = 40

interface QuestionRow {
  id: string
  content: string
  created_at: string
  session_id: string
  user_id: string
}

function excerpt(value: string, max = 400): string {
  const clean = value.replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

/**
 * Recent team questions for Historial. Admins only. The text is an excerpt;
 * opening another person's thread is not offered (`own` is false).
 */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = uuidSchema.parse(req.nextUrl.searchParams.get("chatbotId"))
    await requireChatbotAccess(supabase, user.id, chatbotId, "admin")
    const admin = getAdminClient()

    const { data, error } = await admin
      .from("chat_messages")
      .select("id, content, created_at, session_id, user_id")
      .eq("chatbot_id", chatbotId)
      .eq("role", "user")
      .order("created_at", { ascending: false })
      .limit(LIMIT)
    if (error) throw error

    const rows = (data ?? []) as QuestionRow[]
    const userIds = Array.from(new Set(rows.map((row) => row.user_id)))
    const { data: profiles, error: profileError } = userIds.length
      ? await admin.from("profiles").select("id, email").in("id", userIds)
      : { data: [], error: null }
    if (profileError) throw profileError

    const emailById = new Map<string, string>()
    for (const profile of profiles ?? []) {
      if (profile.email) emailById.set(profile.id, profile.email)
    }

    return NextResponse.json({
      questions: rows.map((row) => ({
        id: row.id,
        text: excerpt(row.content),
        createdAt: row.created_at,
        email: emailById.get(row.user_id) ?? null,
        sessionId: row.session_id,
        own: row.user_id === user.id,
      })),
    })
  } catch (error) {
    return errorResponse(error, "GET /api/history/questions")
  }
}

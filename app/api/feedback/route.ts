import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  questionId: z.union([z.string(), z.number()]).transform(String),
  isPositive: z.boolean(),
  evaluationSet: z.string().trim().min(1).max(200),
  chatbotId: uuidSchema.nullish(),
})

export async function POST(request: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const data = bodySchema.parse(await request.json())

    if (data.chatbotId) {
      await requireChatbotAccess(supabase, user.id, data.chatbotId, "member")
    }

    // The vote itself is written as the user (RLS: own rows only).
    const { error: upsertFeedbackError } = await supabase
      .from("feedback")
      .upsert({
        question_id: data.questionId,
        evaluation_set: data.evaluationSet,
        is_positive: data.isPositive,
        created_by: user.id,
        chatbot_id: data.chatbotId ?? null,
        timestamp: new Date().toISOString(),
      })
    if (upsertFeedbackError) throw upsertFeedbackError

    // The aggregate spans all users, so it is computed and stored server-side.
    const admin = getAdminClient()
    const { data: votes, error: votesError } = await admin
      .from("feedback")
      .select("is_positive")
      .eq("evaluation_set", data.evaluationSet)
    if (votesError) throw votesError

    const positive = (votes ?? []).filter(
      (vote: { is_positive: boolean | null }) => vote.is_positive
    ).length
    const negative = (votes ?? []).length - positive

    const { error: upsertSummaryError } = await admin
      .from("feedback_summary")
      .upsert({ evaluation_set: data.evaluationSet, positive, negative })
    if (upsertSummaryError) throw upsertSummaryError

    return NextResponse.json({ positive, negative }, { status: 200 })
  } catch (error) {
    return errorResponse(error, "POST /api/feedback")
  }
}

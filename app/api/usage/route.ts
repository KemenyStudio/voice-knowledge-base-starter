import { NextRequest, NextResponse } from "next/server"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import { getAdminClient, requireUser } from "@/lib/supabase/server"
import { asMetricsRecord, buildUsagePayload, type StoredEvaluation, type UsageVote } from "@/lib/usage/metrics"

export const dynamic = "force-dynamic"

const VOTE_CAP = 5000

/**
 * Admin metrics for one assistant: usage counts, eval votes, ratings,
 * answers without sources, and the telemetry already stored (tool duration,
 * tool errors, model-call ids, citations, index status).
 * Answer latency and model errors are not stored; the payload leaves them null.
 */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = uuidSchema.parse(req.nextUrl.searchParams.get("chatbotId"))
    await requireChatbotAccess(supabase, user.id, chatbotId, "admin")
    const admin = getAdminClient()

    const [metricsResult, votesResult] = await Promise.all([
      admin.rpc("assistant_usage_metrics", { p_chatbot_id: chatbotId }),
      admin
        .from("feedback")
        .select("evaluation_set, is_positive")
        .eq("chatbot_id", chatbotId)
        .limit(VOTE_CAP),
    ])
    if (metricsResult.error) throw metricsResult.error
    if (votesResult.error) throw votesResult.error

    const votes = (votesResult.data ?? []) as UsageVote[]
    const sets = Array.from(new Set(votes.map((vote) => vote.evaluation_set)))
    const storedResult = sets.length
      ? await admin
          .from("evaluation_results")
          .select("evaluation_set, timestamp, data")
          .in("evaluation_set", sets)
      : { data: [], error: null }
    if (storedResult.error) throw storedResult.error

    const payload = buildUsagePayload(
      asMetricsRecord(metricsResult.data),
      votes,
      (storedResult.data ?? []) as StoredEvaluation[],
      { votesTruncated: votes.length >= VOTE_CAP }
    )
    return NextResponse.json(payload)
  } catch (error) {
    return errorResponse(error, "GET /api/usage")
  }
}

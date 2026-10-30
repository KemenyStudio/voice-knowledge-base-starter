import { NextRequest, NextResponse } from "next/server"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

/** Audit log of tool runs for the assistant (team admins only), newest first. */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = uuidSchema.parse(req.nextUrl.searchParams.get("chatbotId"))
    await requireChatbotAccess(supabase, user.id, chatbotId, "admin")

    const admin = getAdminClient()
    const { data, error } = await admin
      .from("tool_runs")
      .select("id, tool, status, user_id, output_chars, duration_ms, error, created_at")
      .eq("chatbot_id", chatbotId)
      .order("created_at", { ascending: false })
      .limit(50)
    if (error) throw error

    const ids = Array.from(new Set((data ?? []).map((r) => r.user_id).filter(Boolean)))
    const { data: profiles } = ids.length
      ? await admin.from("profiles").select("id, email").in("id", ids)
      : { data: [] as Array<{ id: string; email: string | null }> }
    const email = new Map((profiles ?? []).map((p) => [p.id, p.email]))

    return NextResponse.json({
      runs: (data ?? []).map((run) => ({
        ...run,
        user_email: run.user_id ? (email.get(run.user_id) ?? null) : null,
      })),
    })
  } catch (error) {
    return errorResponse(error, "GET /api/tools/runs")
  }
}

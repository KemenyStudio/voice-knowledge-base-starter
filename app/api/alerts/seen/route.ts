import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  chatbotId: uuidSchema,
  /** Omit to dismiss every alert of this assistant. */
  alertId: uuidSchema.optional(),
})

/** The signed-in user dismisses one change alert (or all of them). */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = bodySchema.parse(await req.json())
    await requireChatbotAccess(supabase, user.id, body.chatbotId, "member")
    const admin = getAdminClient()

    let query = admin
      .from("change_alert_recipients")
      .update({ seen_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .is("seen_at", null)
    if (body.alertId) {
      query = query.eq("alert_id", body.alertId)
    } else {
      const { data } = await admin.from("change_alerts").select("id").eq("chatbot_id", body.chatbotId)
      query = query.in("alert_id", (data ?? []).map((a) => a.id))
    }
    const { error } = await query
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, "POST /api/alerts/seen")
  }
}

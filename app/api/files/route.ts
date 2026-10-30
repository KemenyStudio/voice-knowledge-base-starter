import { NextRequest, NextResponse } from "next/server"

import { parseUuid, requireChatbotAccess } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import { refreshFileStatus } from "@/lib/knowledge/vector-store"
import { getAdminClient, requireUser } from "@/lib/supabase/server"
import type { FileRow } from "@/types/knowledge"

export const maxDuration = 60
export const dynamic = "force-dynamic"

/** Lists the documents of one chatbot (any team member). */
export const GET = async (req: NextRequest) => {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = parseUuid(
      req.nextUrl.searchParams.get("chatbotId"),
      "chatbotId"
    )
    await requireChatbotAccess(supabase, user.id, chatbotId, "member")

    const recentParam = req.nextUrl.searchParams.get("recent")
    if (recentParam !== null) {
      const limit = Math.min(8, Math.max(1, Number.parseInt(recentParam, 10) || 4))
      const { data, error } = await supabase
        .from("files")
        .select("id, file_name, uploaded_at")
        .eq("chatbot_id", chatbotId)
        .order("uploaded_at", { ascending: false })
        .limit(limit)
      if (error) throw error
      return NextResponse.json(data ?? [], { status: 200 })
    }

    const { data, error } = await supabase
      .from("files")
      .select("*")
      .eq("chatbot_id", chatbotId)
      .order("uploaded_at", { ascending: false })
    if (error) throw error

    let files = (data ?? []) as FileRow[]

    // Documents that were still indexing when uploaded: reconcile lazily.
    if (files.some((f) => f.sync_status === "processing")) {
      const admin = getAdminClient()
      files = await Promise.all(files.map((f) => refreshFileStatus(admin, f)))
    }

    return NextResponse.json(files, { status: 200 })
  } catch (error) {
    return errorResponse(error, "GET /api/files")
  }
}

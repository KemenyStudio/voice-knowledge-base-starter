import { NextRequest, NextResponse } from "next/server"

import { parseUuid, requireChatbotAccess } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import { readIndexFileCounts } from "@/lib/knowledge/index-counts"
import { buildLibrarySummary, type SummaryFile } from "@/lib/knowledge/library-summary"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const maxDuration = 30
export const dynamic = "force-dynamic"

/**
 * Admin-only snapshot of one assistant's library.
 *
 * A voice call can GET this. It does not add a Realtime tool. Counts come
 * from the library rows. `counts.indexFiles` is the vector store's completed
 * file count. `counts.chunks` stays null: the index API does not publish a
 * text-fragment total, and this route does not estimate one.
 *
 * The body has no storage paths, vector-store ids, or model keys.
 */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = parseUuid(req.nextUrl.searchParams.get("chatbotId"), "chatbotId")
    const { chatbot } = await requireChatbotAccess(supabase, user.id, chatbotId, "admin")

    const { data, error } = await getAdminClient()
      .from("files")
      .select("*")
      .eq("chatbot_id", chatbotId)
    if (error) throw error

    const index = chatbot.vector_store_id
      ? await readIndexFileCounts(chatbot.vector_store_id)
      : null
    const summary = buildLibrarySummary((data ?? []) as SummaryFile[], {
      audienceEnabled: (chatbot.audience_options ?? []).length > 0,
      index,
    })

    return NextResponse.json(
      { chatbotId, ...summary },
      { headers: { "Cache-Control": "no-store" } }
    )
  } catch (error) {
    return errorResponse(error, "GET /api/files/summary")
  }
}

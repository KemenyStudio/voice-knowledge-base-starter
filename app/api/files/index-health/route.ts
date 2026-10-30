import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import { inspectFileBytes, type IndexHealth } from "@/lib/knowledge/index-readiness"
import { downloadObject } from "@/lib/storage"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const BATCH = 4

const bodySchema = z.object({
  chatbotId: uuidSchema,
})

const unknownHealth = (reason: string): IndexHealth => ({
  score: null,
  verdict: "unknown",
  reasons: [reason],
  canUpload: true,
})

/**
 * Admin-only. Scores a few library files that have not been inspected yet,
 * using the original stored bytes. The Biblioteca calls this until none remain.
 */
export const POST = async (req: NextRequest) => {
  try {
    const { supabase, user } = await requireUser()
    const body = bodySchema.parse(await req.json())
    await requireChatbotAccess(supabase, user.id, body.chatbotId, "admin")
    const admin = getAdminClient()

    const { data: rows, error } = await admin
      .from("files")
      .select("id, file_name, file_type, blob_name")
      .eq("chatbot_id", body.chatbotId)
      .is("index_health", null)
      .order("uploaded_at", { ascending: false })
      .limit(BATCH)
    if (error) throw error

    let scored = 0
    for (const row of rows ?? []) {
      let health: IndexHealth
      if (!row.blob_name) {
        health = unknownHealth("No hay archivo original para evaluarlo.")
      } else {
        try {
          const buffer = await downloadObject(row.blob_name)
          health = await inspectFileBytes(row.file_name, buffer, row.file_type)
        } catch {
          health = unknownHealth("No pudimos evaluar este archivo.")
        }
      }
      const { error: updateError } = await admin
        .from("files")
        .update({
          index_health_score: health.score,
          index_health: health,
        })
        .eq("id", row.id)
      if (!updateError) scored += 1
    }

    const { count } = await admin
      .from("files")
      .select("id", { count: "exact", head: true })
      .eq("chatbot_id", body.chatbotId)
      .is("index_health", null)

    return NextResponse.json({ scored, remaining: count ?? 0 })
  } catch (error) {
    return errorResponse(error, "POST /api/files/index-health")
  }
}

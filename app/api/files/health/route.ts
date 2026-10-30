import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { parseUuid, requireChatbotAccess } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { buildHealthReport } from "@/lib/knowledge/health"
import { removeFromVectorStore } from "@/lib/knowledge/vector-store"
import { getOpenAI } from "@/lib/openai"
import {
  getAdminClient,
  requireUser,
  type AnySupabase,
} from "@/lib/supabase/server"
import type { FileRow } from "@/types/knowledge"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const MAX_ORPHANS_LISTED = 50

/** Files that live in the assistant's search index but have no Library entry. */
async function findOrphans(vectorStoreId: string, knownIds: Set<string>) {
  const openai = getOpenAI()
  const orphanIds: string[] = []
  for await (const file of openai.vectorStores.files.list(vectorStoreId, {
    limit: 100,
  })) {
    if (!knownIds.has(file.id)) orphanIds.push(file.id)
  }
  const listed = orphanIds.slice(0, MAX_ORPHANS_LISTED)
  const names = await Promise.all(
    listed.map(async (id) => {
      try {
        return (await openai.files.retrieve(id)).filename
      } catch {
        return id
      }
    })
  )
  return {
    total: orphanIds.length,
    items: listed.map((id, i) => ({ id, filename: names[i] })),
    allIds: orphanIds,
  }
}

async function load(chatbotId: string, supabase: AnySupabase, userId: string) {
  const { chatbot } = await requireChatbotAccess(
    supabase,
    userId,
    chatbotId,
    "admin"
  )
  const { data, error } = await getAdminClient()
    .from("files")
    .select("*")
    .eq("chatbot_id", chatbotId)
    .order("uploaded_at", { ascending: false })
  if (error) throw error
  const files = (data ?? []) as FileRow[]
  const known = new Set(
    files.map((f) => f.openai_file_id).filter((id): id is string => Boolean(id))
  )
  return { chatbot, files, known }
}

/** Health of one assistant's library (team admins). */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = parseUuid(
      req.nextUrl.searchParams.get("chatbotId"),
      "chatbotId"
    )
    const { chatbot, files, known } = await load(chatbotId, supabase, user.id)

    const report = buildHealthReport(files, {
      audienceEnabled: (chatbot.audience_options ?? []).length > 0,
    })

    let orphans: { total: number; items: Array<{ id: string; filename: string }> } = {
      total: 0,
      items: [],
    }
    if (chatbot.vector_store_id) {
      const found = await findOrphans(chatbot.vector_store_id, known).catch(
        (error) => {
          console.error("[files/health] orphans", error)
          return null
        }
      )
      if (found) orphans = { total: found.total, items: found.items }
    }

    return NextResponse.json({ ...report, orphans })
  } catch (error) {
    return errorResponse(error, "GET /api/files/health")
  }
}

const bodySchema = z.object({
  action: z.literal("remove_orphans"),
  chatbotId: z.string(),
  fileIds: z.array(z.string().min(1).max(100)).min(1).max(50),
})

/** Removes index-only files (no Library entry) from the search index (team admins). */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = bodySchema.parse(await req.json())
    const chatbotId = parseUuid(body.chatbotId, "chatbotId")
    const { chatbot, files, known } = await load(chatbotId, supabase, user.id)
    if (!chatbot.vector_store_id) {
      throw new HttpError(409, "This assistant has no search index")
    }
    // A document being uploaded right now is in the index before its row is
    // linked to it; wait for uploads to settle instead of deleting it.
    const uploading = files.some(
      (f) =>
        !f.openai_file_id &&
        Date.now() - new Date(f.uploaded_at).getTime() < 10 * 60 * 1000
    )
    if (uploading) {
      throw new HttpError(
        409,
        "A document is being uploaded. Try again in a few minutes."
      )
    }

    // Only files that really are orphans of this assistant may be removed.
    const { allIds } = await findOrphans(chatbot.vector_store_id, known)
    const allowed = new Set(allIds)
    const targets = body.fileIds.filter((id) => allowed.has(id))

    let removed = 0
    const failed: string[] = []
    for (const id of targets) {
      try {
        await removeFromVectorStore(chatbot.vector_store_id, id)
        removed += 1
      } catch (error) {
        console.error("[files/health] remove", id, error)
        failed.push(id)
      }
    }
    return NextResponse.json({
      removed,
      skipped: body.fileIds.length - targets.length,
      failed,
    })
  } catch (error) {
    return errorResponse(error, "POST /api/files/health")
  }
}

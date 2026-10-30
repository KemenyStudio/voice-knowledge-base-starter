import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { getAdminClient, requireUser } from "@/lib/supabase/server"
import { ingestProposedBatch } from "@/lib/watch/ingest"
import { isAlreadyInLibrary } from "@/lib/watch/library-match"
import { watchResultNote } from "@/lib/watch/summary"
import {
  collectSourceDrafts,
  type SourceDraft,
  type SourceReport,
} from "@/lib/watch/sources"

export const maxDuration = 300
export const dynamic = "force-dynamic"

const COOLDOWN_MS = 60_000

interface ProposalRow {
  id: string
  source: SourceDraft["source"]
  title: string
  url: string
  published_on: string | null
  organ: string | null
  status: string
  created_at: string
}

function toClient(row: ProposalRow) {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    url: row.url,
    publishedOn: row.published_on,
    organ: row.organ,
    createdAt: row.created_at,
  }
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:"
  } catch {
    return false
  }
}

async function listProposed(chatbotId: string, fileNames: string[]) {
  const admin = getAdminClient()
  const { data, error } = await admin
    .from("source_proposals")
    .select("id, source, title, url, published_on, organ, status, created_at")
    .eq("chatbot_id", chatbotId)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(80)
  if (error) throw error
  return ((data ?? []) as ProposalRow[])
    .filter((row) => !isAlreadyInLibrary(row.title, fileNames))
    .map(toClient)
}

async function fileNames(chatbotId: string): Promise<string[]> {
  const { data, error } = await getAdminClient()
    .from("files")
    .select("file_name")
    .eq("chatbot_id", chatbotId)
  if (error) throw error
  return (data ?? []).map((row) => row.file_name as string)
}

/** Proposals still waiting. Documents already in the library are omitted. */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = uuidSchema.parse(req.nextUrl.searchParams.get("chatbotId"))
    await requireChatbotAccess(supabase, user.id, chatbotId, "admin")
    const proposals = await listProposed(chatbotId, await fileNames(chatbotId))
    return NextResponse.json({ proposals })
  } catch (error) {
    return errorResponse(error, "GET /api/watch")
  }
}

/**
 * Reads the DOF, CNBV and Banxico, then downloads each new official file into
 * this assistant's library through the same upload and index path. A title
 * that is already in the library is skipped and the existing file is left as it is.
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const { chatbotId } = z
      .object({ chatbotId: uuidSchema })
      .parse(await req.json())
    const { chatbot } = await requireChatbotAccess(supabase, user.id, chatbotId, "admin")
    const admin = getAdminClient()
    const names = await fileNames(chatbotId)

    const { data: run } = await admin
      .from("source_watch_runs")
      .select("ran_at")
      .eq("chatbot_id", chatbotId)
      .maybeSingle()
    const skippedScan = Boolean(
      run?.ran_at && Date.now() - new Date(run.ran_at).getTime() < COOLDOWN_MS
    )

    let added = 0
    let reports: SourceReport[] = []
    let already = 0
    if (!skippedScan) {
      const collected = await collectSourceDrafts()
      reports = collected.reports
      const { data: existing, error: existingError } = await admin
        .from("source_proposals")
        .select("source, external_id")
        .eq("chatbot_id", chatbotId)
      if (existingError) throw existingError
      const known = new Set(
        (existing ?? []).map((row) => `${row.source}:${row.external_id}`)
      )

      const seenFresh = new Set<string>()
      const fresh = collected.drafts.filter((draft) => {
        const key = `${draft.source}:${draft.externalId}`
        if (seenFresh.has(key)) return false
        if (!isHttpUrl(draft.url)) return false
        if (known.has(key)) return false
        if (isAlreadyInLibrary(draft.title, names)) {
          already += 1
          return false
        }
        seenFresh.add(key)
        return true
      })

      if (fresh.length > 0) {
        const { error: insertError } = await admin.from("source_proposals").insert(
          fresh.map((draft) => ({
            chatbot_id: chatbotId,
            source: draft.source,
            external_id: draft.externalId,
            title: draft.title,
            url: draft.url,
            published_on: draft.publishedOn,
            organ: draft.organ,
            status: "proposed",
          }))
        )
        if (insertError) throw insertError
      }
      added = fresh.length

      await admin.from("source_watch_runs").upsert({
        chatbot_id: chatbotId,
        ran_at: new Date().toISOString(),
        summary: { reports, added: fresh.length },
      })
    }

    const batch = await ingestProposedBatch(
      { supabase, admin, userId: user.id, chatbot },
      names
    )
    const proposals = await listProposed(chatbotId, names)
    const note = watchResultNote({
      skippedScan,
      ingested: batch.ingested,
      already: already + batch.already,
      failed: batch.failed,
      pending: proposals.length,
    })

    return NextResponse.json({
      skipped: skippedScan,
      added,
      ingested: batch.ingested,
      already: already + batch.already,
      failed: batch.failed,
      reports,
      proposals,
      note,
    })
  } catch (error) {
    return errorResponse(error, "POST /api/watch")
  }
}

/** Dismisses a proposal so it is not downloaded. */
export async function PATCH(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = z
      .object({
        chatbotId: uuidSchema,
        id: uuidSchema,
        status: z.literal("dismissed"),
      })
      .parse(await req.json())
    await requireChatbotAccess(supabase, user.id, body.chatbotId, "admin")

    const { data, error } = await getAdminClient()
      .from("source_proposals")
      .update({ status: "dismissed", dismissed_by: user.id })
      .eq("id", body.id)
      .eq("chatbot_id", body.chatbotId)
      .eq("status", "proposed")
      .select("id")
    if (error) throw error
    if (!data?.length) throw new HttpError(404, "No se encontró esa propuesta.")
    return NextResponse.json({ ok: true })
  } catch (error) {
    return errorResponse(error, "PATCH /api/watch")
  }
}

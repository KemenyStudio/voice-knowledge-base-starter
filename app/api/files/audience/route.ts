import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { normalizeAliases, pickOptions, tagsToAudience } from "@/lib/audience"
import { parseUuid, requireChatbotAccess } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { needsAudienceLabel, resolveAudienceLabel } from "@/lib/knowledge/audience-label"
import { mapLimit, syncAttributes } from "@/lib/knowledge/audience-sync"
import { suggestAudience } from "@/lib/knowledge/classify"
import { getAdminClient, requireUser } from "@/lib/supabase/server"
import type { FileMetadata, FileRow } from "@/types/knowledge"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const SUGGEST_BATCH = 12
const SYNC_BATCH = 40

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("from_tags"), chatbotId: z.string() }),
  z.object({
    action: z.literal("suggest"),
    chatbotId: z.string(),
    fileIds: z.array(z.string().uuid()).max(SUGGEST_BATCH).optional(),
  }),
  z.object({
    action: z.literal("accept"),
    chatbotId: z.string(),
    fileIds: z.array(z.string().uuid()).max(200).optional(),
  }),
  z.object({
    action: z.literal("set"),
    chatbotId: z.string(),
    fileId: z.string().uuid(),
    audience: z.array(z.string().max(80)).max(8),
  }),
  z.object({
    action: z.literal("sync"),
    chatbotId: z.string(),
    offset: z.number().int().min(0).default(0),
  }),
])

/**
 * Admin actions on the audience of the documents of one assistant. Every
 * action is explicit: nothing is classified, confirmed or hidden on its own.
 *
 *  - from_tags: derive the audience from the tags documents already have
 *  - suggest:   read documents that still have no audience and write who they
 *               are for (the label and, when it is safe, the filter)
 *  - accept:    confirm any suggestion that was stored earlier
 *  - set:       set the audience of one document by hand
 *  - sync:      rewrite the search index attributes (batched; call until next = null)
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = bodySchema.parse(await req.json())
    const chatbotId = parseUuid(body.chatbotId, "chatbotId")
    const { chatbot } = await requireChatbotAccess(
      supabase,
      user.id,
      chatbotId,
      "admin"
    )
    const options = chatbot.audience_options ?? []
    if (options.length === 0) {
      throw new HttpError(
        400,
        "Define los perfiles de audiencia de este asistente antes de clasificar documentos"
      )
    }
    const admin = getAdminClient()

    const loadFiles = async (ids?: string[], filter?: (f: FileRow) => boolean) => {
      let query = admin.from("files").select("*").eq("chatbot_id", chatbotId)
      if (ids) query = query.in("id", ids)
      const { data, error } = await query.order("uploaded_at", {
        ascending: false,
      })
      if (error) throw error
      const rows = (data ?? []) as FileRow[]
      return filter ? rows.filter(filter) : rows
    }

    const applyAudience = async (
      file: FileRow,
      patch: Partial<
        Pick<FileRow, "audience" | "audience_suggested" | "audience_status" | "metadata">
      >
    ): Promise<FileRow> => {
      const { data, error } = await admin
        .from("files")
        .update(patch)
        .eq("id", file.id)
        .eq("chatbot_id", chatbotId)
        .select("*")
        .single()
      if (error || !data) throw error ?? new Error("Update failed")
      return data as FileRow
    }

    if (body.action === "from_tags") {
      const pending = await loadFiles(
        undefined,
        (f) => f.audience_status === "unclassified"
      )
      const changed: FileRow[] = []
      let unmatched = 0
      for (const file of pending) {
        const audience = tagsToAudience(
          file.metadata?.target_tag ?? [],
          options,
          normalizeAliases(chatbot.audience_aliases)
        )
        if (!audience || audience.length === 0) {
          unmatched += 1
          continue
        }
        changed.push(
          await applyAudience(file, {
            audience,
            audience_suggested: [],
            audience_status: "confirmed",
          })
        )
      }
      const sync = await syncAttributes(chatbot, changed)
      return NextResponse.json({
        imported: changed.length,
        unmatched,
        index: sync,
      })
    }

    if (body.action === "suggest") {
      const targets = (await loadFiles(body.fileIds, needsAudienceLabel)).slice(
        0,
        SUGGEST_BATCH
      )

      let labeled = 0
      let failed = 0
      const changed: FileRow[] = []
      await mapLimit(targets, 4, async (file) => {
        try {
          const reading = await suggestAudience({
            vectorStoreId: file.vector_store_id as string,
            fileRowId: file.id,
            fileName: file.file_name,
            options,
          })
          const resolved = reading ? resolveAudienceLabel(options, reading) : null
          if (!resolved) {
            failed += 1
            return
          }
          const metadata: FileMetadata = {
            type_tag: file.metadata?.type_tag ?? "",
            target_tag: resolved.labels,
            entity_tag: file.metadata?.entity_tag ?? [],
            context: file.metadata?.context ?? "",
          }
          changed.push(
            await applyAudience(file, {
              audience: resolved.audience,
              audience_suggested: [],
              audience_status: "confirmed",
              metadata,
            })
          )
          labeled += 1
        } catch (error) {
          console.error("[audience suggest]", file.id, error)
          failed += 1
        }
      })

      const index = await syncAttributes(chatbot, changed)
      const remaining = (await loadFiles(undefined, needsAudienceLabel)).length
      return NextResponse.json({
        labeled,
        suggested: labeled,
        failed,
        remaining,
        index,
      })
    }

    if (body.action === "accept") {
      const pending = await loadFiles(
        body.fileIds,
        (f) => f.audience_status === "suggested"
      )
      const changed: FileRow[] = []
      for (const file of pending) {
        const audience = pickOptions(options, file.audience_suggested ?? [])
        const hasTag = (file.metadata?.target_tag ?? []).length > 0
        const metadata: FileMetadata | undefined =
          !hasTag && audience.length > 0
            ? {
                type_tag: file.metadata?.type_tag ?? "",
                target_tag: audience,
                entity_tag: file.metadata?.entity_tag ?? [],
                context: file.metadata?.context ?? "",
              }
            : undefined
        changed.push(
          await applyAudience(file, {
            audience,
            audience_suggested: [],
            audience_status: "confirmed",
            ...(metadata ? { metadata } : {}),
          })
        )
      }
      const sync = await syncAttributes(chatbot, changed)
      return NextResponse.json({ accepted: changed.length, index: sync })
    }

    if (body.action === "set") {
      const [file] = await loadFiles([body.fileId])
      if (!file) throw new HttpError(404, "File not found")
      const updated = await applyAudience(file, {
        audience: pickOptions(options, body.audience),
        audience_suggested: [],
        audience_status: "confirmed",
      })
      const sync = await syncAttributes(chatbot, [updated])
      return NextResponse.json({
        file: updated,
        warning: sync.failed.length
          ? "Saved, but the search index could not be updated."
          : undefined,
      })
    }

    const { data, error } = await admin
      .from("files")
      .select("*")
      .eq("chatbot_id", chatbotId)
      .order("uploaded_at", { ascending: true })
      .range(body.offset, body.offset + SYNC_BATCH - 1)
    if (error) throw error
    const batch = (data ?? []) as FileRow[]
    const index = await syncAttributes(chatbot, batch)
    return NextResponse.json({
      ...index,
      next: batch.length === SYNC_BATCH ? body.offset + SYNC_BATCH : null,
    })
  } catch (error) {
    return errorResponse(error, "POST /api/files/audience")
  }
}

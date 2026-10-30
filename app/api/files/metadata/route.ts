import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { pickOptions } from "@/lib/audience"
import { parseUuid, requireChatbotAccess, requireFileAccess, uuidSchema } from "@/lib/auth/access"
import { DOCUMENT_TYPE_SUGGESTIONS } from "@/app/config/assistant-defaults"
import { errorResponse, HttpError } from "@/lib/http"
import { syncAttributes } from "@/lib/knowledge/audience-sync"
import {
  ASTRA_METADATA_FIELDS,
  applyMetadataProposal,
  hasMetadataGap,
} from "@/lib/knowledge/document-metadata"
import { proposeDocumentMetadata } from "@/lib/knowledge/propose-metadata"
import { readStoredDocumentText } from "@/lib/knowledge/read-document-text"
import { getAdminClient, requireUser } from "@/lib/supabase/server"
import type { ChatbotRow, FileRow } from "@/types/knowledge"

export const maxDuration = 300
export const dynamic = "force-dynamic"

const FILL_BATCH = 2

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("propose"),
    chatbotId: uuidSchema,
    fileId: z.string().uuid().optional(),
    fileName: z.string().trim().max(255).optional(),
    text: z.string().max(20_000).optional(),
  }),
  z.object({
    action: z.literal("fill_empty"),
    chatbotId: uuidSchema,
    skipIds: z.array(z.string().uuid()).max(500).default([]),
  }),
])

function libraryHints(files: FileRow[], options: string[]) {
  const labels = new Set<string>(options)
  const types = new Set<string>(DOCUMENT_TYPE_SUGGESTIONS)
  for (const file of files) {
    for (const tag of file.metadata?.target_tag ?? []) labels.add(tag)
    const type = file.metadata?.type_tag?.trim()
    if (type) types.add(type)
  }
  return {
    knownLabels: Array.from(labels).slice(0, 40),
    knownTypes: Array.from(types).slice(0, 24),
  }
}

/**
 * Admin-only. Astra reads document text and proposes metadata.
 * propose returns a draft for the upload or edit dialog.
 * fill_empty writes only the empty fields of documents that still lack them.
 * Neither action deletes a file or uploads a new copy.
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = bodySchema.parse(await req.json())
    const chatbotId = parseUuid(body.chatbotId, "chatbotId")
    const { chatbot } = await requireChatbotAccess(supabase, user.id, chatbotId, "admin")
    const admin = getAdminClient()

    const { data, error } = await admin
      .from("files")
      .select("*")
      .eq("chatbot_id", chatbotId)
    if (error) throw error
    const library = (data ?? []) as FileRow[]
    const hints = libraryHints(library, chatbot.audience_options ?? [])

    switch (body.action) {
      case "propose":
        return NextResponse.json(
          await proposeOne({
            supabase,
            userId: user.id,
            chatbot,
            hints,
            fileId: body.fileId,
            fileName: body.fileName,
            text: body.text,
          })
        )
      case "fill_empty":
        return NextResponse.json(
          await fillEmpty({
            chatbot,
            library,
            hints,
            skipIds: new Set(body.skipIds),
          })
        )
      default: {
        const unreachable: never = body
        throw new HttpError(400, `Unsupported action: ${String(unreachable)}`)
      }
    }
  } catch (error) {
    return errorResponse(error, "POST /api/files/metadata")
  }
}

async function proposeOne(input: {
  supabase: Parameters<typeof requireFileAccess>[0]
  userId: string
  chatbot: ChatbotRow
  hints: { knownLabels: string[]; knownTypes: string[] }
  fileId?: string
  fileName?: string
  text?: string
}) {
  const options = input.chatbot.audience_options ?? []
  let fileName = input.fileName?.trim() || "documento"
  let text = input.text?.trim() || ""
  if (input.fileId) {
    const { file } = await requireFileAccess(
      input.supabase,
      input.userId,
      input.fileId,
      "admin"
    )
    if (file.chatbot_id !== input.chatbot.id) {
      throw new HttpError(404, "File not found")
    }
    fileName = file.file_name
    text = await readStoredDocumentText(file)
  }
  if (text.trim().length < 40) {
    return { proposal: null }
  }
  const proposal = await proposeDocumentMetadata({
    fileName,
    text,
    options,
    knownLabels: input.hints.knownLabels,
    knownTypes: input.hints.knownTypes,
  })
  return { proposal }
}

async function fillEmpty(input: {
  chatbot: ChatbotRow
  library: FileRow[]
  hints: { knownLabels: string[]; knownTypes: string[] }
  skipIds: Set<string>
}) {
  const pending = input.library.filter(
    (file) => hasMetadataGap(file) && !input.skipIds.has(file.id)
  )
  const batch = pending.slice(0, FILL_BATCH)
  const options = input.chatbot.audience_options ?? []
  const attemptedIds: string[] = []
  const changed: FileRow[] = []
  let updated = 0
  let failed = 0
  let skipped = 0
  const admin = getAdminClient()

  for (const file of batch) {
    attemptedIds.push(file.id)
    try {
      const text = await readStoredDocumentText(file)
      const proposal = await proposeDocumentMetadata({
        fileName: file.file_name,
        text,
        options,
        knownLabels: input.hints.knownLabels,
        knownTypes: input.hints.knownTypes,
      })
      if (!proposal) {
        skipped += 1
        continue
      }
      const applied = applyMetadataProposal(
        { fileName: file.file_name, metadata: file.metadata },
        proposal
      )
      if (applied.wrote.length === 0) {
        skipped += 1
        continue
      }
      const wroteAudience = applied.wrote.includes("audiencia")
      const patch = {
        file_name: applied.fileName,
        metadata: {
          ...(file.metadata ?? {}),
          type_tag: applied.metadata.type_tag,
          target_tag: applied.metadata.target_tag,
          entity_tag: applied.metadata.entity_tag,
          context: applied.metadata.context,
        },
        ...(wroteAudience
          ? {
              audience: pickOptions(options, proposal.audienciaFiltro),
              audience_suggested: [],
              audience_status: "confirmed" as const,
            }
          : {}),
      }
      const { data, error } = await admin
        .from("files")
        .update(patch)
        .eq("id", file.id)
        .eq("chatbot_id", input.chatbot.id)
        .select("*")
        .single()
      if (error || !data) throw error ?? new Error("Update failed")
      changed.push(data as FileRow)
      updated += 1
    } catch (error) {
      console.error("[fill_empty]", file.id, error)
      failed += 1
    }
  }

  await syncAttributes(input.chatbot, changed)
  const done = new Set(attemptedIds)
  input.skipIds.forEach((id) => done.add(id))
  const remaining = input.library.filter(
    (file) => hasMetadataGap(file) && !done.has(file.id) && !changed.some((row) => row.id === file.id)
  ).length

  return {
    updated,
    failed,
    skipped,
    attemptedIds,
    remaining,
    fields: ASTRA_METADATA_FIELDS,
  }
}

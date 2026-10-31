import { inspectFileBytes } from "@/lib/knowledge/index-readiness"
import { commitLibraryUpload } from "@/lib/knowledge/commit-upload"
import { normalizeMetadata } from "@/lib/knowledge/metadata"
import { buildStoragePath, deleteObject, uploadObject } from "@/lib/storage"
import type { AnySupabase } from "@/lib/supabase/server"
import type { ChatbotRow, FileMetadata, FileRow } from "@/types/knowledge"
import { isAlreadyInLibrary } from "@/lib/watch/library-match"
import { fetchOfficialDocument } from "@/lib/watch/official-file"
import { SOURCE_IDS, type SourceId } from "@/lib/watch/sources"

/** How many official files one click indexes. The rest stay proposed. */
export const INGEST_BATCH = 5

const STALE_CLAIM_MS = 15 * 60 * 1000

export interface IngestRow {
  id: string
  source: string
  external_id: string
  title: string
  url: string
  organ: string | null
}

export interface IngestBatchResult {
  ingested: number
  already: number
  failed: number
}

interface IngestContext {
  supabase: AnySupabase
  admin: AnySupabase
  userId: string
  chatbot: ChatbotRow
}

function metadataFor(source: SourceId, organ: string | null): FileMetadata {
  const entity = organ ? [organ.slice(0, 200)] : []
  switch (source) {
    case "dof":
      return normalizeMetadata({ type_tag: "Diario Oficial", entity_tag: entity })
    case "cnbv":
      return normalizeMetadata({ type_tag: "CNBV", entity_tag: entity })
    case "banxico":
      return normalizeMetadata({ type_tag: "Banxico", entity_tag: entity })
    default: {
      const unknown: never = source
      return unknown
    }
  }
}

function asSource(value: string): SourceId | null {
  return (SOURCE_IDS as readonly string[]).includes(value) ? (value as SourceId) : null
}

export async function releaseStaleClaims(admin: AnySupabase, chatbotId: string): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_CLAIM_MS).toISOString()
  await admin
    .from("source_proposals")
    .update({ status: "proposed", claimed_at: null })
    .eq("chatbot_id", chatbotId)
    .eq("status", "ingesting")
    .or(`claimed_at.is.null,claimed_at.lt.${cutoff}`)
  await admin
    .from("source_proposals")
    .update({ status: "proposed", ingested_at: null })
    .eq("chatbot_id", chatbotId)
    .eq("status", "ingested")
    .is("file_id", null)
}

async function claim(
  admin: AnySupabase,
  chatbotId: string,
  id: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("source_proposals")
    .update({ status: "ingesting", claimed_at: new Date().toISOString() })
    .eq("id", id)
    .eq("chatbot_id", chatbotId)
    .eq("status", "proposed")
    .select("id")
  if (error) throw error
  return (data ?? []).length > 0
}

async function release(admin: AnySupabase, id: string): Promise<void> {
  await admin
    .from("source_proposals")
    .update({ status: "proposed", claimed_at: null })
    .eq("id", id)
    .eq("status", "ingesting")
}

async function markIngested(
  admin: AnySupabase,
  id: string,
  fileId: string
): Promise<void> {
  const { error } = await admin
    .from("source_proposals")
    .update({
      status: "ingested",
      file_id: fileId,
      ingested_at: new Date().toISOString(),
      claimed_at: null,
    })
    .eq("id", id)
    .eq("status", "ingesting")
  if (error) throw error
}

export type IngestOutcome =
  | { status: "ingested"; file: FileRow }
  | { status: "already" }
  | { status: "failed" }
  | { status: "missing" }

/**
 * Downloads one proposed official file and adds it through the library upload
 * path. A title that is already in the library is skipped and nothing is replaced.
 */
export async function ingestProposal(
  ctx: IngestContext,
  row: IngestRow,
  fileNames: string[]
): Promise<IngestOutcome> {
  const source = asSource(row.source)
  if (!source) return { status: "failed" }
  if (isAlreadyInLibrary(row.title, fileNames)) return { status: "already" }

  const claimed = await claim(ctx.admin, ctx.chatbot.id, row.id)
  if (!claimed) return { status: "missing" }

  let storagePath: string | null = null
  let saved: FileRow | null = null
  try {
    const doc = await fetchOfficialDocument({
      source,
      externalId: row.external_id,
      url: row.url,
      title: row.title,
    })
    if (!doc) {
      await release(ctx.admin, row.id)
      return { status: "failed" }
    }
    if (
      isAlreadyInLibrary(row.title, fileNames) ||
      isAlreadyInLibrary(doc.fileName, fileNames)
    ) {
      await release(ctx.admin, row.id)
      return { status: "already" }
    }

    const health = await inspectFileBytes(doc.fileName, doc.bytes)
    if (!health.canUpload) {
      await release(ctx.admin, row.id)
      return { status: "failed" }
    }

    storagePath = buildStoragePath(ctx.chatbot.team_id, ctx.chatbot.id, doc.fileName)
    await uploadObject(storagePath, doc.bytes, {
      contentType: doc.contentType.split(";")[0],
    })
    const { file } = await commitLibraryUpload({
      supabase: ctx.supabase,
      admin: ctx.admin,
      userId: ctx.userId,
      chatbot: ctx.chatbot,
      fileName: doc.fileName,
      buffer: doc.bytes,
      metadata: metadataFor(source, row.organ),
      storagePath,
    })
    saved = file
    storagePath = null
    await markIngested(ctx.admin, row.id, file.id)
    fileNames.push(file.file_name)
    return { status: "ingested", file }
  } catch (error) {
    if (saved) {
      await markIngested(ctx.admin, row.id, saved.id).catch(() => undefined)
      fileNames.push(saved.file_name)
      return { status: "ingested", file: saved }
    }
    console.error("[ingestProposal]", row.id, error instanceof Error ? error.message : "failed")
    if (storagePath) await deleteObject(storagePath).catch(() => undefined)
    await release(ctx.admin, row.id).catch(() => undefined)
    return { status: "failed" }
  }
}

export async function ingestProposedBatch(
  ctx: IngestContext,
  fileNames: string[]
): Promise<IngestBatchResult> {
  await releaseStaleClaims(ctx.admin, ctx.chatbot.id)
  const { data, error } = await ctx.admin
    .from("source_proposals")
    .select("id, source, external_id, title, url, organ")
    .eq("chatbot_id", ctx.chatbot.id)
    .eq("status", "proposed")
    .order("created_at", { ascending: false })
    .limit(40)
  if (error) throw error

  const result: IngestBatchResult = { ingested: 0, already: 0, failed: 0 }
  let attempted = 0
  for (const row of (data ?? []) as IngestRow[]) {
    if (isAlreadyInLibrary(row.title, fileNames)) continue
    if (attempted >= INGEST_BATCH) break
    attempted += 1
    const outcome = await ingestProposal(ctx, row, fileNames)
    switch (outcome.status) {
      case "ingested":
        result.ingested += 1
        break
      case "already":
        result.already += 1
        break
      case "failed":
        result.failed += 1
        break
      case "missing":
        break
      default: {
        const unknown: never = outcome
        return unknown
      }
    }
  }
  return result
}

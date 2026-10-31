import { toFile } from "openai"

import { audienceAttributes } from "@/lib/audience"
import { getOpenAI } from "@/lib/openai"
import { CHUNKING_STRATEGY } from "@/lib/retrieval"
import type { AnySupabase } from "@/lib/supabase/server"
import type { IndexHealth } from "@/lib/knowledge/index-readiness"
import type {
  ChatbotRow,
  FileMetadata,
  FileRow,
  SyncStatus,
} from "@/types/knowledge"

type Attributes = Record<string, string | number | boolean>

const ATTRIBUTE_VALUE_MAX = 512

function clip(value: string): string {
  return value.length > ATTRIBUTE_VALUE_MAX
    ? value.slice(0, ATTRIBUTE_VALUE_MAX)
    : value
}

/**
 * Attributes stored next to every vector store file. They make retrieval
 * filterable (file_search `filters`) and let a search result be traced back to
 * the database row. OpenAI allows 16 keys with string/number/boolean values.
 */
export function buildAttributes(input: {
  fileRowId: string
  chatbotId: string
  fileName: string
  metadata: Partial<FileMetadata> | null
  /** Entity types of the assistant and the ones this document applies to. */
  audience?: { options: string[]; applies: string[] }
}): Attributes {
  const attributes: Attributes = {
    file_row_id: input.fileRowId,
    chatbot_id: input.chatbotId,
    file_name: clip(input.fileName),
  }
  const { type_tag, target_tag, entity_tag, context } = input.metadata ?? {}
  if (type_tag) attributes.type_tag = clip(type_tag)
  if (target_tag?.length) attributes.target_tag = clip(target_tag.join(", "))
  if (entity_tag?.length) attributes.entity_tag = clip(entity_tag.join(", "))
  if (context?.trim()) attributes.context = clip(context.trim())
  if (input.audience) {
    Object.assign(
      attributes,
      audienceAttributes(input.audience.options, input.audience.applies)
    )
  }
  return attributes
}

function isNotFound(error: unknown): boolean {
  return (error as { status?: number } | null)?.status === 404
}

/**
 * Returns the chatbot's vector store, creating it on first use. Safe under
 * concurrent uploads: the first writer wins, the loser deletes its store.
 */
export async function ensureVectorStore(
  admin: AnySupabase,
  chatbot: Pick<ChatbotRow, "id" | "name" | "team_id" | "vector_store_id">
): Promise<string> {
  if (chatbot.vector_store_id) return chatbot.vector_store_id

  const openai = getOpenAI()
  const store = await openai.vectorStores.create({
    name: `${chatbot.name}`.slice(0, 200) || "chatbot",
    metadata: { chatbot_id: chatbot.id, team_id: chatbot.team_id },
  })

  const { data, error } = await admin
    .from("chatbots")
    .update({ vector_store_id: store.id })
    .eq("id", chatbot.id)
    .is("vector_store_id", null)
    .select("vector_store_id")
    .maybeSingle()

  if (error) {
    await openai.vectorStores.delete(store.id).catch(() => undefined)
    throw error
  }
  if (data?.vector_store_id === store.id) return store.id

  // Another request created the store first.
  await openai.vectorStores.delete(store.id).catch(() => undefined)
  const { data: fresh, error: readError } = await admin
    .from("chatbots")
    .select("vector_store_id")
    .eq("id", chatbot.id)
    .single()
  if (readError || !fresh?.vector_store_id) {
    throw readError ?? new Error("Could not resolve the chatbot vector store")
  }
  return fresh.vector_store_id
}

function mapStatus(status: string): SyncStatus {
  if (status === "completed") return "ready"
  if (status === "failed" || status === "cancelled") return "failed"
  return "processing"
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export interface VectorFileResult {
  openaiFileId: string
  status: SyncStatus
  error: string | null
}

/**
 * Name sent to OpenAI. File search decides whether it can read a file from the
 * extension, but a row's `file_name` is a display title that may have none
 * (legacy documents, or a rename), so the extension comes from `file_type`.
 */
export function uploadFileName(fileName: string, fileType: string | null): string {
  const type = (fileType ?? "").replace(/^\./, "").toLowerCase()
  if (!type || fileName.toLowerCase().endsWith(`.${type}`)) return fileName
  return `${fileName}.${type}`
}

/**
 * Uploads a document to OpenAI and attaches it to the vector store. Waits a
 * bounded time for indexing; if it is still running the status is
 * "processing" and refreshFileStatus() reconciles it later.
 */
export async function uploadToVectorStore(input: {
  vectorStoreId: string
  buffer: Buffer
  fileName: string
  attributes: Attributes
  waitMs?: number
}): Promise<VectorFileResult> {
  const openai = getOpenAI()
  const uploaded = await openai.files.create({
    file: await toFile(input.buffer, input.fileName),
    purpose: "assistants",
  })

  try {
    let vsFile = await openai.vectorStores.files.create(input.vectorStoreId, {
      file_id: uploaded.id,
      attributes: input.attributes,
      // Applies to this new file only. Already indexed files are not replaced.
      chunking_strategy: CHUNKING_STRATEGY,
    })

    const deadline = Date.now() + (input.waitMs ?? 45_000)
    while (vsFile.status === "in_progress" && Date.now() < deadline) {
      await sleep(1500)
      vsFile = await openai.vectorStores.files.retrieve(uploaded.id, {
        vector_store_id: input.vectorStoreId,
      })
    }

    return {
      openaiFileId: uploaded.id,
      status: mapStatus(vsFile.status),
      error: vsFile.last_error?.message ?? null,
    }
  } catch (error) {
    await openai.files.delete(uploaded.id).catch(() => undefined)
    throw error
  }
}

export async function updateVectorFileAttributes(
  vectorStoreId: string,
  openaiFileId: string,
  attributes: Attributes
): Promise<void> {
  await getOpenAI().vectorStores.files.update(openaiFileId, {
    vector_store_id: vectorStoreId,
    attributes,
  })
}

/** File name for a text copy that replaces the indexed PDF. The library title is unchanged. */
export function indexTextUploadName(fileName: string): string {
  const base = fileName.replace(/[\\/]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180) || "document"
  return base.toLowerCase().endsWith(".txt") ? base : `${base}.txt`
}

/**
 * Uploads extracted text as the document's search-index file and points the
 * row at it. The stored original (`blob_name`) and the library row stay.
 * On a failed upload the previous index file is left in place.
 */
export async function replaceIndexWithText(input: {
  admin: AnySupabase
  file: FileRow
  chatbot: ChatbotRow
  text: string
  health: IndexHealth
}): Promise<{ file: FileRow; replaced: boolean; error: string | null }> {
  const { admin, file, chatbot, text, health } = input
  const vectorStoreId = await ensureVectorStore(admin, chatbot)
  const result = await uploadToVectorStore({
    vectorStoreId,
    buffer: Buffer.from(text, "utf8"),
    fileName: indexTextUploadName(file.file_name),
    attributes: buildAttributes({
      fileRowId: file.id,
      chatbotId: chatbot.id,
      fileName: file.file_name,
      metadata: file.metadata,
      audience: {
        options: chatbot.audience_options ?? [],
        applies: file.audience ?? [],
      },
    }),
    waitMs: 90_000,
  })

  if (result.status === "failed") {
    await removeFromVectorStore(vectorStoreId, result.openaiFileId)
    return { file, replaced: false, error: result.error ?? "Indexing failed" }
  }

  const patch = {
    openai_file_id: result.openaiFileId,
    vector_store_id: vectorStoreId,
    sync_status: result.status,
    sync_error: result.error,
    index_health_score: health.score,
    index_health: health,
  }
  const { data, error } = await admin
    .from("files")
    .update(patch)
    .eq("id", file.id)
    .select("*")
    .single()
  if (error) {
    await removeFromVectorStore(vectorStoreId, result.openaiFileId)
    throw error
  }

  if (
    file.openai_file_id &&
    file.vector_store_id &&
    file.openai_file_id !== result.openaiFileId
  ) {
    try {
      await removeFromVectorStore(file.vector_store_id, file.openai_file_id)
    } catch (removeError) {
      console.error("[replaceIndexWithText] previous index file", file.id, removeError)
    }
  }

  return { file: data as FileRow, replaced: true, error: null }
}

/** Removes a document from the vector store and deletes the OpenAI file. Missing objects are ignored. */
export async function removeFromVectorStore(
  vectorStoreId: string,
  openaiFileId: string
): Promise<void> {
  const openai = getOpenAI()
  try {
    await openai.vectorStores.files.delete(openaiFileId, {
      vector_store_id: vectorStoreId,
    })
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
  try {
    await openai.files.delete(openaiFileId)
  } catch (error) {
    if (!isNotFound(error)) throw error
  }
}

/** Reconciles rows still marked "processing" with the state OpenAI reports. */
export async function refreshFileStatus(
  admin: AnySupabase,
  file: FileRow
): Promise<FileRow> {
  if (
    file.sync_status !== "processing" ||
    !file.openai_file_id ||
    !file.vector_store_id
  ) {
    return file
  }
  try {
    const vsFile = await getOpenAI().vectorStores.files.retrieve(
      file.openai_file_id,
      { vector_store_id: file.vector_store_id }
    )
    const status = mapStatus(vsFile.status)
    if (status === file.sync_status) return file
    const patch = {
      sync_status: status,
      sync_error: vsFile.last_error?.message ?? null,
    }
    const { data } = await admin
      .from("files")
      .update(patch)
      .eq("id", file.id)
      .select("*")
      .single()
    return (data as FileRow | null) ?? { ...file, ...patch }
  } catch (error) {
    console.error("[refreshFileStatus]", file.id, error)
    return file
  }
}

/**
 * Indexes a stored document: ensures the chatbot's vector store, replaces any
 * previous copy, uploads, and records the outcome on the row. Never throws for
 * indexing problems; the failure is recorded so the UI can offer a retry.
 */
export async function syncFileRow(input: {
  admin: AnySupabase
  file: FileRow
  chatbot: ChatbotRow
  buffer: Buffer
}): Promise<FileRow> {
  const { admin, file, chatbot, buffer } = input
  try {
    const vectorStoreId = await ensureVectorStore(admin, chatbot)

    if (file.openai_file_id && file.vector_store_id) {
      await removeFromVectorStore(file.vector_store_id, file.openai_file_id)
    }

    const result = await uploadToVectorStore({
      vectorStoreId,
      buffer,
      fileName: uploadFileName(file.file_name, file.file_type),
      attributes: buildAttributes({
        fileRowId: file.id,
        chatbotId: chatbot.id,
        fileName: file.file_name,
        metadata: file.metadata,
        audience: {
          options: chatbot.audience_options ?? [],
          applies: file.audience ?? [],
        },
      }),
    })

    const patch = {
      openai_file_id: result.openaiFileId,
      vector_store_id: vectorStoreId,
      sync_status: result.status,
      sync_error: result.error,
    }
    const { data, error } = await admin
      .from("files")
      .update(patch)
      .eq("id", file.id)
      .select("*")
      .single()
    if (error) throw error
    return data as FileRow
  } catch (error) {
    console.error("[syncFileRow]", file.id, error)
    const message =
      error instanceof Error ? error.message.slice(0, 500) : "Indexing failed"
    const patch = { sync_status: "failed" as const, sync_error: message }
    const { data } = await admin
      .from("files")
      .update(patch)
      .eq("id", file.id)
      .select("*")
      .single()
    return (data as FileRow | null) ?? { ...file, ...patch }
  }
}

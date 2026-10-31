import { detectChangeAlerts } from "@/lib/alerts"
import { pickOptions } from "@/lib/audience"
import { HttpError } from "@/lib/http"
import { inspectFileBytes, type IndexHealth } from "@/lib/knowledge/index-readiness"
import { getExtension } from "@/lib/knowledge/metadata"
import { syncFileRow } from "@/lib/knowledge/vector-store"
import { deleteObject } from "@/lib/storage"
import type { AnySupabase } from "@/lib/supabase/server"
import type { ChatbotRow, FileMetadata, FileRow } from "@/types/knowledge"

export interface CommitLibraryUploadInput {
  supabase: AnySupabase
  admin: AnySupabase
  userId: string
  chatbot: ChatbotRow
  fileName: string
  buffer: Buffer
  metadata: FileMetadata
  /** Object already stored under this assistant's folder. */
  storagePath: string
  /**
   * When set, the new document's filter audience is this list (known profiles
   * only) and the decision is confirmed. Unknown sectors stay out of the filter.
   */
  audience?: string[]
}

/**
 * Records a file that is already in private storage, scores whether the
 * index can read it, and indexes it in this assistant's vector store.
 * Inserts a new library row. Does not update or delete any other file.
 */
export async function commitLibraryUpload(
  input: CommitLibraryUploadInput
): Promise<{ file: FileRow; suggestions: number }> {
  const { supabase, admin, chatbot, buffer, storagePath } = input
  const ext = getExtension(input.fileName)
  let indexHealth: IndexHealth
  try {
    indexHealth = await inspectFileBytes(input.fileName, buffer)
  } catch {
    indexHealth = {
      score: null,
      verdict: "unknown",
      reasons: ["No pudimos evaluar este archivo."],
      canUpload: true,
    }
  }

  const { data: inserted, error: insertError } = await supabase
    .from("files")
    .insert({
      chatbot_id: chatbot.id,
      file_name: input.fileName,
      file_type: ext,
      file_url: "",
      metadata: input.metadata,
      blob_name: storagePath,
      sync_status: "processing",
      size_bytes: buffer.length,
      uploaded_by: input.userId,
      index_health_score: indexHealth.score,
      index_health: indexHealth,
      ...(input.audience
        ? {
            audience: pickOptions(chatbot.audience_options ?? [], input.audience),
            audience_suggested: [],
            audience_status: "confirmed" as const,
          }
        : {}),
    })
    .select("*")
    .single()

  if (insertError || !inserted) {
    await deleteObject(storagePath).catch(() => undefined)
    throw insertError ?? new HttpError(500, "Could not save the file record")
  }

  const { data: withUrl } = await admin
    .from("files")
    .update({ file_url: `/api/files/${inserted.id}/download` })
    .eq("id", inserted.id)
    .select("*")
    .single()

  const file = await syncFileRow({
    admin,
    file: (withUrl ?? inserted) as FileRow,
    chatbot,
    buffer,
  })

  const suggestions =
    file.sync_status === "failed"
      ? 0
      : await detectChangeAlerts(admin, chatbot.id, {
          id: file.id,
          file_name: file.file_name,
        })

  return { file, suggestions }
}

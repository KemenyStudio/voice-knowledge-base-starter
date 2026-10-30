import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { parseUuid, requireFileAccess } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { pickOptions } from "@/lib/audience"
import { metadataSchema } from "@/lib/knowledge/metadata"
import {
  buildAttributes,
  removeFromVectorStore,
  updateVectorFileAttributes,
} from "@/lib/knowledge/vector-store"
import { deleteObject } from "@/lib/storage"
import { getAdminClient, requireUser } from "@/lib/supabase/server"
import type { FileRow } from "@/types/knowledge"

export const maxDuration = 60
export const dynamic = "force-dynamic"

const updateSchema = z.object({
  fileName: z.string().trim().min(1).max(255).optional(),
  metadata: metadataSchema,
  /** Filter audience. Omitted leaves the current filter unchanged. */
  audience: z.array(z.string().trim().max(80)).max(8).optional(),
})

/** Document details (any team member). */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { supabase, user } = await requireUser()
    const { file } = await requireFileAccess(
      supabase,
      user.id,
      parseUuid(params.id),
      "member"
    )
    return NextResponse.json(file)
  } catch (error) {
    return errorResponse(error, "GET /api/files/:id")
  }
}

/** Rename and re-tag a document, keeping the database and the vector store in sync (team admins). */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { supabase, user } = await requireUser()
    const body = updateSchema.parse(await req.json())
    const { file, chatbot } = await requireFileAccess(
      supabase,
      user.id,
      parseUuid(params.id),
      "admin"
    )

    const patch = {
      metadata: body.metadata,
      ...(body.fileName ? { file_name: body.fileName } : {}),
      ...(body.audience !== undefined
        ? {
            audience: pickOptions(chatbot.audience_options ?? [], body.audience),
            audience_suggested: [] as string[],
            audience_status: "confirmed" as const,
          }
        : {}),
    }
    const { data: updated, error } = await supabase
      .from("files")
      .update(patch)
      .eq("id", file.id)
      .select("*")
      .single()
    if (error || !updated) throw error ?? new Error("Update failed")
    const row = updated as FileRow

    let warning: string | undefined
    if (row.openai_file_id && row.vector_store_id) {
      try {
        await updateVectorFileAttributes(
          row.vector_store_id,
          row.openai_file_id,
          buildAttributes({
            fileRowId: row.id,
            chatbotId: chatbot.id,
            fileName: row.file_name,
            metadata: row.metadata,
            audience: {
              options: chatbot.audience_options ?? [],
              applies: row.audience ?? [],
            },
          })
        )
      } catch (err) {
        console.error("[PUT /api/files/:id] vector store attributes", err)
        warning = "Saved, but the search index could not be updated."
      }
    }

    return NextResponse.json({ success: true, file: row, warning })
  } catch (error) {
    return errorResponse(error, "PUT /api/files/:id")
  }
}

const flagSchema = z.object({
  outdated: z.boolean(),
  note: z.string().trim().max(300).nullish(),
})

/**
 * Flags a document as outdated (or clears the flag). Only a flag: the document
 * is still searched, and answers that cite it carry a warning (team admins).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { supabase, user } = await requireUser()
    const body = flagSchema.parse(await req.json())
    const { file } = await requireFileAccess(
      supabase,
      user.id,
      parseUuid(params.id),
      "admin"
    )
    const { data, error } = await supabase
      .from("files")
      .update({
        outdated: body.outdated,
        outdated_note: body.outdated ? body.note || null : null,
      })
      .eq("id", file.id)
      .select("*")
      .single()
    if (error || !data) throw error ?? new Error("Update failed")
    return NextResponse.json({ success: true, file: data as FileRow })
  } catch (error) {
    return errorResponse(error, "PATCH /api/files/:id")
  }
}

/** Remove a document everywhere: vector store, file storage and database (team admins). */
export const DELETE = async (
  _req: NextRequest,
  { params }: { params: { id: string } }
) => {
  try {
    const { supabase, user } = await requireUser()
    const { file } = await requireFileAccess(
      supabase,
      user.id,
      parseUuid(params.id),
      "admin"
    )

    // Index first: if OpenAI is unreachable we keep the row so the delete can
    // be retried instead of leaving an orphaned, still searchable copy.
    let indexOrphaned = false
    if (file.openai_file_id && file.vector_store_id) {
      try {
        await removeFromVectorStore(file.vector_store_id, file.openai_file_id)
      } catch (err) {
        console.error("[DELETE /api/files/:id] vector store", err)
        throw new HttpError(
          502,
          "Could not remove the document from the search index. Try again."
        )
      }
    } else if (file.sync_status === "external") {
      // Legacy document indexed outside the app and not yet linked to its
      // OpenAI file id (see scripts/backfill-openai-file-ids.mjs).
      indexOrphaned = true
    }

    // Legacy rows that were never copied to Supabase Storage have no path.
    if (file.blob_name) {
      await deleteObject(file.blob_name).catch((err) =>
        console.error("[DELETE /api/files/:id] storage", err)
      )
    }

    const { error } = await getAdminClient()
      .from("files")
      .delete()
      .eq("id", file.id)
    if (error) throw error

    return NextResponse.json({
      success: true,
      warning: indexOrphaned
        ? "The document was removed from the library, but a legacy copy may remain in the search index."
        : undefined,
    })
  } catch (error) {
    return errorResponse(error, "DELETE /api/files/:id")
  }
}

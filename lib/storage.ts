import { randomUUID } from "crypto"

import { getAdminClient } from "@/lib/supabase/server"

/**
 * Original documents live in a private Supabase Storage bucket. Nothing in the
 * bucket is readable with the anon or user keys (no storage policies exist);
 * every access goes through the service-role client after the caller's team
 * membership has been checked in the route.
 */
export const STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "knowledge"

function bucket() {
  return getAdminClient().storage.from(STORAGE_BUCKET)
}

/**
 * Object path for a new upload: `<teamId>/<chatbotId>/<uuid>-<safe name>`.
 * Scoped by team and chatbot and made unique so two teams can upload
 * "ley.pdf" without overwriting each other. Storage keys must be plain ASCII;
 * the real file name is kept in `files.file_name`.
 */
export function buildStoragePath(
  teamId: string,
  chatbotId: string,
  fileName: string
): string {
  const dot = fileName.lastIndexOf(".")
  const stem = dot > 0 ? fileName.slice(0, dot) : fileName
  const ext = dot > 0 ? fileName.slice(dot + 1) : ""
  const clean = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
  const safeStem = clean(stem).slice(0, 80) || "document"
  const safeExt = clean(ext).slice(0, 10)
  return `${teamId}/${chatbotId}/${randomUUID()}-${safeStem}${safeExt ? `.${safeExt}` : ""}`
}

export async function uploadObject(
  path: string,
  data: Buffer,
  options: { contentType?: string } = {}
): Promise<void> {
  const { error } = await bucket().upload(path, data, {
    contentType: options.contentType,
    upsert: false,
  })
  if (error) throw error
}

/**
 * One-time signed upload target for a path, so a browser can upload directly
 * to the private bucket without the file passing through our server.
 */
export async function createUploadTarget(
  path: string
): Promise<{ bucket: string; path: string; token: string }> {
  const { data, error } = await bucket().createSignedUploadUrl(path)
  if (error || !data) throw error ?? new Error("Could not create an upload URL")
  return { bucket: STORAGE_BUCKET, path: data.path, token: data.token }
}

/** True when `path` sits inside the chatbot's own folder of the bucket. */
export function isChatbotStoragePath(
  path: string,
  teamId: string,
  chatbotId: string
): boolean {
  return (
    path.startsWith(`${teamId}/${chatbotId}/`) &&
    !path.includes("..") &&
    path.split("/").length === 3
  )
}

export async function downloadObject(path: string): Promise<Buffer> {
  const { data, error } = await bucket().download(path)
  if (error || !data) throw error ?? new Error("Object not found")
  return Buffer.from(await data.arrayBuffer())
}

/** Deletes an object; a missing object is not an error. */
export async function deleteObject(path: string): Promise<void> {
  const { error } = await bucket().remove([path])
  if (error) throw error
}

/**
 * Short-lived read URL for a private object. Documents are only ever exposed
 * through this after the caller's team membership has been checked.
 */
export async function createReadUrl(
  path: string,
  options: { expiresInMinutes?: number } = {}
): Promise<string> {
  const { data, error } = await bucket().createSignedUrl(
    path,
    (options.expiresInMinutes ?? 10) * 60
  )
  if (error || !data) throw error ?? new Error("Could not sign the URL")
  return data.signedUrl
}

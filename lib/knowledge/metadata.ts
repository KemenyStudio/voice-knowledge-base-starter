import { z } from "zod"

import type { FileMetadata } from "@/types/knowledge"

const tagList = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => {
    const list = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : []
    return Array.from(
      new Set(list.map((item) => item.trim()).filter(Boolean))
    ).slice(0, 30)
  })

/** Accepts the metadata the UI sends (tags as array or comma string) and normalizes it. */
export const metadataSchema = z
  .object({
    type_tag: z.string().trim().max(200).optional().default(""),
    target_tag: tagList,
    entity_tag: tagList,
    context: z.string().trim().max(600).optional().default(""),
  })
  .default({})

export function normalizeMetadata(raw: unknown): FileMetadata {
  return metadataSchema.parse(raw ?? {})
}

const ALLOWED_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "pptx",
  "txt",
  "md",
  "html",
  "json",
])

export function getExtension(fileName: string): string {
  const i = fileName.lastIndexOf(".")
  return i === -1 ? "" : fileName.slice(i + 1).toLowerCase()
}

export function isAllowedExtension(fileName: string): boolean {
  return ALLOWED_EXTENSIONS.has(getExtension(fileName))
}

export const ALLOWED_EXTENSIONS_LABEL = Array.from(ALLOWED_EXTENSIONS).join(", ")

export const MAX_UPLOAD_BYTES =
  (Number.parseInt(process.env.MAX_UPLOAD_MB ?? "", 10) || 25) * 1024 * 1024

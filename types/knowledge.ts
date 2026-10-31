import type { SuggestedQuestionGroup } from "@/types/chatbot"

export type TeamRole = "admin" | "member"

export type AudienceStatus = "unclassified" | "suggested" | "confirmed"

export type SyncStatus =
  | "pending"
  | "processing"
  | "ready"
  | "failed"
  | "external"

export interface ChatbotRow {
  id: string
  name: string
  description: string | null
  team_id: string
  vector_store_id: string | null
  system_prompt: string | null
  welcome_message: string | null
  suggested_questions: SuggestedQuestionGroup[]
  audience_options: string[]
  /** Tag shorthand configured for this assistant. Absent until the column exists. */
  audience_aliases?: Record<string, string[]>
  audience_filter: boolean
  prompt_notes: string[]
  research_enabled: boolean
  enabled_tools: string[]
  created_at: string | null
}

export interface FileMetadata {
  type_tag: string
  target_tag: string[]
  entity_tag: string[]
  /** Short Spanish summary of what the document is and who it binds. */
  context: string
}

export interface FileRow {
  id: string
  chatbot_id: string
  file_name: string
  file_type: string | null
  file_url: string
  uploaded_at: string
  metadata: Partial<FileMetadata> | null
  blob_name: string | null
  openai_file_id: string | null
  vector_store_id: string | null
  sync_status: SyncStatus
  sync_error: string | null
  size_bytes: number | null
  uploaded_by: string | null
  audience: string[]
  audience_suggested: string[]
  audience_status: AudienceStatus
  outdated: boolean
  outdated_note: string | null
  superseded_by: string | null
  index_health_score: number | null
  index_health: {
    score: number | null
    verdict: "good" | "review" | "unknown"
    reasons: string[]
    canUpload: boolean
  } | null
}

/**
 * Where a retrieved passage sits in the original file, taken only from
 * citation metadata. A null page means the citation did not say.
 */
export interface CitationLocation {
  page: string | null
  article: string | null
  fileLocation: string | null
}

/** Citation returned by /api/chat, shaped for the existing chat UI. */
export interface ChatCitation {
  number: number
  file_id: string
  filename: string
  title: string
  text: string
  score: number
  attributes: Record<string, string | number | boolean>
  /** Authenticated download URL of the source document (null if unknown). */
  file_url: string | null
  /** The document was flagged as outdated by an admin. */
  outdated?: boolean
  /** Page, article, or in-file location when the search result included it. */
  location?: CitationLocation
}

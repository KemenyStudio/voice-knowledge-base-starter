import type { PassageContext } from "@/lib/chat/passage"
import type { ChatCitation } from "@/types/knowledge"
import type { WebLookup } from "@/lib/web-search"

export interface ChatMessage {
  /** OpenAI response id for assistant messages that were saved. */
  id?: string
  role: "user" | "assistant"
  content: string
  citations?: ChatCitation[]
  followUps?: string[]
  /** The answer is a clarifying question; its options are shown as buttons. */
  clarify?: { question: string; options: string[]; kind?: "entity_type" }
  /** Whether the search was limited to the user's entity type. */
  entityFilter?: { applied: boolean; entity: string | null }
  /** Research mode: the searches behind this answer. */
  research?: {
    steps: Array<{
      id?: number
      label: string
      sources: number
      status?: "searching" | "done"
    }>
  }
  /** The assistant message is an error notice, offer a retry. */
  error?: boolean
  /** The owner pinned this turn so a long thread has an outline. */
  pinned?: boolean
  /** Folder name grouping this turn inside the conversation. */
  folder?: string | null
  /** Web hits. They are not library citations. */
  webSources?: WebLookup | null
  /** Passage from Fuentes used as context for this question. */
  passage?: PassageContext
}

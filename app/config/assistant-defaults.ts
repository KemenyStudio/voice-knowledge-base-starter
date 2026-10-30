import type { SuggestedQuestionGroup } from "@/types/chatbot"

/**
 * Neutral defaults for a new assistant. Used only when the assistant row
 * has no welcome text or example questions yet.
 *
 * Keep the question list and the welcome sentence in sync with
 * supabase/migrations/20261028120000_generic_assistant_defaults.sql.
 */

/** Browser title and landing heading. Set NEXT_PUBLIC_APP_NAME per deployment. */
export const appName = process.env.NEXT_PUBLIC_APP_NAME?.trim() || "Document Search"

/** Shown in the empty chat when the assistant has no welcome_message yet. */
export function defaultWelcomeMessage(name: string): string {
  const assistant = name.trim() || "Document Search"
  return `Hello, I'm ${assistant}. Ask about this private document library and I will answer with cited passages.`
}

export const DEFAULT_SUGGESTED_QUESTIONS: SuggestedQuestionGroup[] = [
  {
    category: "Start",
    prompts: [
      "What do the documents in this library cover?",
      "Summarize the main points in these documents.",
      "Which topics are in the library, and which are not?",
    ],
  },
]

/** Suggestions for the optional document-type field. Not a closed list. */
export const DOCUMENT_TYPE_SUGGESTIONS = [
  "Informe",
  "Manual",
  "Contrato",
  "Guía",
  "Política",
  "Procedimiento",
  "Acta",
  "Presentación",
  "Nota",
  "Anexo",
]

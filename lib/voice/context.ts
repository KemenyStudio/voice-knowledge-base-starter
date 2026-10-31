import { requireChatbotAccess } from "@/lib/auth/access"
import { HttpError } from "@/lib/http"
import { EMPTY_PREFS, getPrefs, type AssistantPrefs } from "@/lib/preferences"
import { requireUser, type AnySupabase } from "@/lib/supabase/server"
import type { ChatbotRow } from "@/types/knowledge"

export const NO_DOCUMENTS_MESSAGE =
  "Este asistente todavía no tiene documentos. Un administrador del equipo debe subirlos en la Biblioteca antes de poder responder preguntas."

export const NO_INDEX_MESSAGE =
  "Este asistente tiene documentos pero todavía no tiene índice de búsqueda. Un administrador debe reindexarlos desde la Biblioteca."

export interface VoiceContext {
  supabase: AnySupabase
  userId: string
  chatbot: ChatbotRow
  documents: Array<{ audience: string[] | null }>
  options: string[]
  entity: string | null
  /** Read when the call starts, and again for each library answer. */
  callSettings: Pick<AssistantPrefs, "length" | "navigation">
}

/** Signed-in member, same document index the chat searches. No second store. */
export async function loadVoiceContext(chatbotId: string): Promise<VoiceContext> {
  const { supabase, user } = await requireUser()
  const { chatbot } = await requireChatbotAccess(
    supabase,
    user.id,
    chatbotId,
    "member"
  )

  const { data: documents, error } = await supabase
    .from("files")
    .select("audience")
    .eq("chatbot_id", chatbot.id)
  if (error) throw error
  if (!documents?.length) throw new HttpError(409, NO_DOCUMENTS_MESSAGE)
  if (!chatbot.vector_store_id) throw new HttpError(409, NO_INDEX_MESSAGE)

  const options = chatbot.audience_options ?? []
  const prefs = await getPrefs(supabase, user.id, chatbot.id, options).catch((prefsError) => {
    console.error("getPrefs", prefsError)
    return EMPTY_PREFS
  })

  return {
    supabase,
    userId: user.id,
    chatbot,
    documents: documents as Array<{ audience: string[] | null }>,
    options,
    entity: prefs.entity_type,
    callSettings: { length: prefs.length, navigation: prefs.navigation },
  }
}

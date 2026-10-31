import { findOption } from "@/lib/audience"
import type { AnySupabase } from "@/lib/supabase/server"
import {
  parseVoiceCallSettings,
  type VoiceCallSettings,
} from "@/lib/voice/call-settings"

export interface AssistantPrefs extends VoiceCallSettings {
  entity_type: string | null
  entity_prompt_dismissed: boolean
  /** E-mail notices about changed documents. Opt-in, off by default. */
  email_alerts: boolean
}

export const EMPTY_PREFS: AssistantPrefs = {
  entity_type: null,
  entity_prompt_dismissed: false,
  email_alerts: false,
  length: "normal",
  navigation: "app",
}

/**
 * What the assistant remembers about one user. The stored entity type is only
 * returned while it is still one of the assistant's configured options.
 */
export async function getPrefs(
  supabase: AnySupabase,
  userId: string,
  chatbotId: string,
  options: string[]
): Promise<AssistantPrefs> {
  const { data, error } = await supabase
    .from("assistant_user_prefs")
    .select("entity_type, entity_prompt_dismissed, email_alerts, voice_length, voice_navigation")
    .eq("user_id", userId)
    .eq("chatbot_id", chatbotId)
    .maybeSingle()
  if (error) throw error
  if (!data) return EMPTY_PREFS
  const call = parseVoiceCallSettings(data)
  return {
    entity_type: data.entity_type ? findOption(options, data.entity_type) : null,
    entity_prompt_dismissed: Boolean(data.entity_prompt_dismissed),
    email_alerts: Boolean(data.email_alerts),
    length: call.length,
    navigation: call.navigation,
  }
}

export async function savePrefs(
  supabase: AnySupabase,
  userId: string,
  chatbotId: string,
  patch: Partial<AssistantPrefs>
): Promise<void> {
  const row: Record<string, unknown> = {
    user_id: userId,
    chatbot_id: chatbotId,
    updated_at: new Date().toISOString(),
  }
  if (patch.entity_type !== undefined) row.entity_type = patch.entity_type
  if (patch.entity_prompt_dismissed !== undefined) {
    row.entity_prompt_dismissed = patch.entity_prompt_dismissed
  }
  if (patch.email_alerts !== undefined) row.email_alerts = patch.email_alerts
  if (patch.length !== undefined) row.voice_length = patch.length
  if (patch.navigation !== undefined) row.voice_navigation = patch.navigation

  const { error } = await supabase.from("assistant_user_prefs").upsert(row, {
    onConflict: "user_id,chatbot_id",
  })
  if (error) throw error
}

import { z } from "zod"

import { HttpError } from "@/lib/http"
import type { AnySupabase } from "@/lib/supabase/server"
import type { ChatbotRow, FileRow, TeamRole } from "@/types/knowledge"

export const uuidSchema = z.string().uuid()

export function parseUuid(value: unknown, label = "id"): string {
  const parsed = uuidSchema.safeParse(value)
  if (!parsed.success) throw new HttpError(400, `Invalid ${label}`)
  return parsed.data
}

/** Role of the user in the team, or null when they are not a member. */
export async function getTeamRole(
  supabase: AnySupabase,
  teamId: string,
  userId: string
): Promise<TeamRole | null> {
  const { data, error } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", teamId)
    .eq("user_id", userId)
    .maybeSingle()
  if (error) throw error
  if (!data) return null
  return data.role === "admin" ? "admin" : "member"
}

export async function requireTeamRole(
  supabase: AnySupabase,
  teamId: string,
  userId: string,
  required: TeamRole = "member"
): Promise<TeamRole> {
  const role = await getTeamRole(supabase, teamId, userId)
  if (!role) throw new HttpError(403, "You are not a member of this team")
  if (required === "admin" && role !== "admin") {
    throw new HttpError(403, "Only team admins can do this")
  }
  return role
}

/**
 * Loads a chatbot and verifies the user's role in its team. The membership
 * check is explicit (not only RLS) so authorization holds even before the
 * RLS hardening migration is applied.
 */
export async function requireChatbotAccess(
  supabase: AnySupabase,
  userId: string,
  chatbotId: string,
  required: TeamRole = "member"
): Promise<{ chatbot: ChatbotRow; role: TeamRole }> {
  const { data, error } = await supabase
    .from("chatbots")
    .select("*")
    .eq("id", chatbotId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, "Chatbot not found")
  const chatbot = data as ChatbotRow
  const role = await requireTeamRole(supabase, chatbot.team_id, userId, required)
  return { chatbot, role }
}

/** Loads a file and verifies access through its chatbot's team. */
export async function requireFileAccess(
  supabase: AnySupabase,
  userId: string,
  fileId: string,
  required: TeamRole = "member"
): Promise<{ file: FileRow; chatbot: ChatbotRow; role: TeamRole }> {
  const { data, error } = await supabase
    .from("files")
    .select("*")
    .eq("id", fileId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new HttpError(404, "File not found")
  const file = data as FileRow
  const { chatbot, role } = await requireChatbotAccess(
    supabase,
    userId,
    file.chatbot_id,
    required
  )
  return { file, chatbot, role }
}

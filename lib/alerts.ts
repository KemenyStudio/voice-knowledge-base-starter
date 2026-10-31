import { sendEmail } from "@/lib/emails"
import { changeAlertTemplate } from "@/lib/emails/templates/change-alert"
import { supersessionCandidates, type NamedFile } from "@/lib/alert-match"
import { HttpError } from "@/lib/http"
import type { AnySupabase } from "@/lib/supabase/server"

/**
 * After an upload: suggests "this replaces that". Only creates PENDING alerts;
 * nothing changes for anyone until an admin confirms. Best effort.
 */
export async function detectChangeAlerts(
  admin: AnySupabase,
  chatbotId: string,
  newFile: NamedFile
): Promise<number> {
  try {
    const { data, error } = await admin
      .from("files")
      .select("id, file_name, superseded_by")
      .eq("chatbot_id", chatbotId)
    if (error) throw error
    const candidates = supersessionCandidates(newFile, (data ?? []) as NamedFile[])
    if (candidates.length === 0) return 0
    const { error: insertError } = await admin.from("change_alerts").upsert(
      candidates.map((c) => ({
        chatbot_id: chatbotId,
        new_file_id: newFile.id,
        old_file_id: c.file.id,
        source: "detected",
        status: "pending",
        score: Math.round(c.score * 100) / 100,
      })),
      { onConflict: "new_file_id,old_file_id", ignoreDuplicates: true }
    )
    if (insertError) throw insertError
    return candidates.length
  } catch (error) {
    console.error("detectChangeAlerts", error)
    return 0
  }
}

/**
 * Members whose answers cited the old document: they asked about that topic.
 * Only people still in the team.
 */
export async function usersWhoSawDocument(
  admin: AnySupabase,
  chatbotId: string,
  teamId: string,
  oldFileId: string
): Promise<string[]> {
  const { data, error } = await admin
    .from("chat_messages")
    .select("user_id")
    .eq("chatbot_id", chatbotId)
    .eq("role", "assistant")
    .contains("citations", JSON.stringify([{ url: `/api/files/${oldFileId}/download` }]))
  if (error) throw error
  const asked = Array.from(new Set((data ?? []).map((r: { user_id: string }) => r.user_id)))
  if (asked.length === 0) return []
  const { data: members, error: memberError } = await admin
    .from("team_members")
    .select("user_id")
    .eq("team_id", teamId)
    .in("user_id", asked)
  if (memberError) throw memberError
  return (members ?? []).map((m: { user_id: string }) => m.user_id)
}

interface AlertRow {
  id: string
  chatbot_id: string
  new_file_id: string
  old_file_id: string
  status: string
}

export interface Audience {
  recipients: string[]
  /** Recipients who turned e-mail notices on for this assistant. */
  emailOptIn: string[]
}

export async function alertAudience(
  admin: AnySupabase,
  chatbot: { id: string; team_id: string },
  oldFileId: string
): Promise<Audience> {
  const recipients = await usersWhoSawDocument(admin, chatbot.id, chatbot.team_id, oldFileId)
  if (recipients.length === 0) return { recipients, emailOptIn: [] }
  const { data, error } = await admin
    .from("assistant_user_prefs")
    .select("user_id")
    .eq("chatbot_id", chatbot.id)
    .eq("email_alerts", true)
    .in("user_id", recipients)
  if (error) throw error
  return {
    recipients,
    emailOptIn: (data ?? []).map((r: { user_id: string }) => r.user_id),
  }
}

/**
 * Confirms a replacement: links the versions, flags the old document as
 * outdated (keeping any note an admin already wrote), notifies the people who
 * saw it in the app, and e-mails only those who opted in AND only if the admin
 * asked for it.
 */
export async function publishAlert(input: {
  admin: AnySupabase
  chatbot: { id: string; name: string; team_id: string }
  alertId: string
  adminId: string
  sendEmails: boolean
  origin: string
}): Promise<{ recipients: number; emailed: number; failed: number }> {
  const { admin, chatbot } = input
  const { data: alert, error } = await admin
    .from("change_alerts")
    .select("id, chatbot_id, new_file_id, old_file_id, status")
    .eq("id", input.alertId)
    .eq("chatbot_id", chatbot.id)
    .maybeSingle()
  if (error) throw error
  if (!alert) throw new HttpError(404, "Alert not found")
  const row = alert as AlertRow
  if (row.status === "published") throw new HttpError(409, "The alert is already published")

  const { data: files } = await admin
    .from("files")
    .select("id, file_name, outdated, outdated_note")
    .in("id", [row.new_file_id, row.old_file_id])
  const newFile = files?.find((f: { id: string }) => f.id === row.new_file_id)
  const oldFile = files?.find((f: { id: string }) => f.id === row.old_file_id)
  if (!newFile || !oldFile) throw new HttpError(404, "Document not found")

  await admin
    .from("files")
    .update({
      superseded_by: newFile.id,
      outdated: true,
      outdated_note: oldFile.outdated_note || `Reemplazado por «${newFile.file_name}»`,
    })
    .eq("id", oldFile.id)

  const audience = await alertAudience(admin, chatbot, oldFile.id)
  if (audience.recipients.length > 0) {
    const { error: recipientError } = await admin.from("change_alert_recipients").upsert(
      audience.recipients.map((user_id) => ({ alert_id: row.id, user_id })),
      { onConflict: "alert_id,user_id", ignoreDuplicates: true }
    )
    if (recipientError) throw recipientError
  }

  await admin
    .from("change_alerts")
    .update({ status: "published", published_at: new Date().toISOString(), decided_by: input.adminId })
    .eq("id", row.id)

  let emailed = 0
  let failed = 0
  if (input.sendEmails && audience.emailOptIn.length > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, email")
      .in("id", audience.emailOptIn)
    const mail = changeAlertTemplate({
      assistantName: chatbot.name,
      newTitle: newFile.file_name,
      oldTitle: oldFile.file_name,
      link: `${input.origin}/chatbot/${chatbot.id}`,
    })
    for (const profile of profiles ?? []) {
      if (!profile.email) continue
      const result = await sendEmail({ to: profile.email, ...mail })
      if (result.success) {
        emailed++
        await admin
          .from("change_alert_recipients")
          .update({ emailed_at: new Date().toISOString() })
          .eq("alert_id", row.id)
          .eq("user_id", profile.id)
      } else {
        failed++
      }
    }
  }
  return { recipients: audience.recipients.length, emailed, failed }
}

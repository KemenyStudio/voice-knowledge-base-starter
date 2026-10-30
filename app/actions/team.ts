"use server"

import { headers } from "next/headers"
import { z } from "zod"

import { HttpError } from "@/lib/http"
import {
  getAdminClient,
  getAnonClient,
  requireUserInAction,
} from "@/lib/supabase/server"
import { getTeamRole, requireTeamRole } from "@/lib/auth/access"
import { sendEmail } from "@/lib/emails"
import { teamInvitationTemplate } from "@/lib/emails/templates/team-invitation"

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? {} : T))
  | { ok: false; error: string }

function failure(error: unknown, fallback: string): { ok: false; error: string } {
  if (error instanceof HttpError) return { ok: false, error: error.message }
  console.error("[team action]", error)
  return { ok: false, error: fallback }
}

/** Public base URL for links in e-mails. Prefer NEXT_PUBLIC_APP_URL; fall back to the request host. */
function appOrigin(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL
  if (configured) return configured.replace(/\/$/, "")
  const h = headers()
  const host = h.get("x-forwarded-host") ?? h.get("host")
  if (!host) throw new Error("Set NEXT_PUBLIC_APP_URL to build invitation links")
  return `${h.get("x-forwarded-proto") ?? "https"}://${host}`
}

/** Whether the signed-in user administers the team. (The user comes from the session, never from an argument.) */
export async function checkTeamAdmin(teamId: string): Promise<boolean> {
  try {
    const { supabase, user } = await requireUserInAction()
    return (await getTeamRole(supabase, teamId, user.id)) === "admin"
  } catch {
    return false
  }
}

const inviteSchema = z.object({
  teamId: z.string().uuid(),
  email: z.string().trim().toLowerCase().email().max(254),
  role: z.enum(["member", "admin"]),
})

/**
 * Adds an existing user to the team, or e-mails an invitation to a new one.
 * Team admins only.
 */
export async function inviteMember(
  input: z.input<typeof inviteSchema>
): Promise<ActionResult<{ status: "added" | "invited" }>> {
  try {
    const { teamId, email, role } = inviteSchema.parse(input)
    const { supabase, user } = await requireUserInAction()
    await requireTeamRole(supabase, teamId, user.id, "admin")

    const admin = getAdminClient()

    const { data: team } = await admin
      .from("teams")
      .select("name")
      .eq("id", teamId)
      .single()

    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", email)
      .maybeSingle()

    if (existing) {
      const { error } = await admin
        .from("team_members")
        .upsert(
          { team_id: teamId, user_id: existing.id, role },
          { onConflict: "team_id,user_id", ignoreDuplicates: true }
        )
      if (error) throw error
      return { ok: true, status: "added" }
    }

    const { data: invitation, error: invitationError } = await admin
      .from("invitations")
      .insert({ team_id: teamId, email, role })
      .select("id")
      .single()
    if (invitationError || !invitation) throw invitationError

    const template = teamInvitationTemplate({
      inviteeEmail: email,
      teamName: team?.name ?? "tu equipo",
      inviterName: user.email ?? "Un administrador",
      invitationLink: `${appOrigin()}/invitation/${invitation.id}`,
      expirationHours: 24,
    })
    const sent = await sendEmail({ to: email, ...template })
    if (!sent.success) {
      await admin.from("invitations").delete().eq("id", invitation.id)
      return { ok: false, error: "No se pudo enviar el correo de invitación" }
    }
    return { ok: true, status: "invited" }
  } catch (error) {
    return failure(error, "No se pudo completar la invitación")
  }
}

const acceptSchema = z.object({
  invitationId: z.string().uuid(),
  password: z.string().min(8).max(72),
})

/**
 * Public action: creates the account for an invitation and joins the team.
 * The team and role come from the invitation row, never from the URL.
 */
export async function acceptInvitation(
  input: z.input<typeof acceptSchema>
): Promise<ActionResult> {
  try {
    const { invitationId, password } = acceptSchema.parse(input)
    const admin = getAdminClient()

    const { data: invitation } = await admin
      .from("invitations")
      .select("id, team_id, email, role, expires_at")
      .eq("id", invitationId)
      .maybeSingle()

    if (!invitation || new Date(invitation.expires_at) < new Date()) {
      return { ok: false, error: "Esta invitación no existe o ha expirado." }
    }

    const { data: existing } = await admin
      .from("profiles")
      .select("id")
      .eq("email", invitation.email)
      .maybeSingle()

    let userId = existing?.id as string | undefined

    if (!userId) {
      const { data, error } = await getAnonClient().auth.signUp({
        email: invitation.email,
        password,
      })
      if (error) return { ok: false, error: error.message }
      // Supabase hides "already registered" behind an empty identities list.
      if (!data.user || data.user.identities?.length === 0) {
        return {
          ok: false,
          error: "Ya existe una cuenta con este correo. Inicia sesión.",
        }
      }
      userId = data.user.id
    }

    const { error: memberError } = await admin
      .from("team_members")
      .upsert(
        { team_id: invitation.team_id, user_id: userId, role: invitation.role },
        { onConflict: "team_id,user_id", ignoreDuplicates: true }
      )
    if (memberError) throw memberError

    await admin.from("invitations").delete().eq("id", invitation.id)
    return { ok: true }
  } catch (error) {
    return failure(error, "No se pudo aceptar la invitación")
  }
}

/**
 * Lets a signed-in user accept an invitation addressed to their own e-mail.
 * The invitation must match the session's e-mail, so a forwarded link cannot
 * be used by someone else.
 */
export async function joinWithInvitation(
  invitationId: string
): Promise<ActionResult<{ teamId: string }>> {
  try {
    const id = z.string().uuid().parse(invitationId)
    const { user } = await requireUserInAction()
    const admin = getAdminClient()

    const { data: invitation } = await admin
      .from("invitations")
      .select("id, team_id, email, role, expires_at")
      .eq("id", id)
      .maybeSingle()

    if (!invitation || new Date(invitation.expires_at) < new Date()) {
      return { ok: false, error: "Esta invitación no existe o ha expirado." }
    }
    if (invitation.email.toLowerCase() !== (user.email ?? "").toLowerCase()) {
      return {
        ok: false,
        error: `Esta invitación es para ${invitation.email}. Cierra sesión e inicia con esa cuenta.`,
      }
    }

    const { error: memberError } = await admin
      .from("team_members")
      .upsert(
        { team_id: invitation.team_id, user_id: user.id, role: invitation.role },
        { onConflict: "team_id,user_id", ignoreDuplicates: true }
      )
    if (memberError) throw memberError

    await admin.from("invitations").delete().eq("id", invitation.id)
    return { ok: true, teamId: invitation.team_id as string }
  } catch (error) {
    return failure(error, "No se pudo aceptar la invitación")
  }
}

/** Public read of the minimal fields needed to render the invitation page. */
export async function getInvitation(
  invitationId: string
): Promise<{ id: string; email: string; teamName: string } | null> {
  const parsed = z.string().uuid().safeParse(invitationId)
  if (!parsed.success) return null
  const { data } = await getAdminClient()
    .from("invitations")
    .select("id, email, expires_at, teams(name)")
    .eq("id", parsed.data)
    .maybeSingle()
  if (!data || new Date(data.expires_at) < new Date()) return null
  const team = Array.isArray(data.teams) ? data.teams[0] : data.teams
  return { id: data.id, email: data.email, teamName: team?.name ?? "" }
}

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { alertAudience, publishAlert } from "@/lib/alerts"
import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const maxDuration = 120
export const dynamic = "force-dynamic"

const RECENT_DAYS = 60

interface AlertRow {
  id: string
  new_file_id: string
  old_file_id: string
  status: string
  source: string
  score: number | null
  published_at: string | null
  created_at: string
}

async function withNames(
  admin: ReturnType<typeof getAdminClient>,
  rows: AlertRow[]
) {
  const ids = Array.from(new Set(rows.flatMap((r) => [r.new_file_id, r.old_file_id])))
  const { data } = ids.length
    ? await admin.from("files").select("id, file_name").in("id", ids)
    : { data: [] as Array<{ id: string; file_name: string }> }
  const name = new Map((data ?? []).map((f) => [f.id, f.file_name]))
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    source: r.source,
    score: r.score,
    publishedAt: r.published_at,
    createdAt: r.created_at,
    newFile: { id: r.new_file_id, name: name.get(r.new_file_id) ?? "Documento" },
    oldFile: { id: r.old_file_id, name: name.get(r.old_file_id) ?? "Documento" },
  }))
}

/**
 * Members: published changes to documents that appeared in their own answers
 * and that they have not dismissed. Admins (`scope=review`): suggestions
 * waiting for a decision and the latest published alerts.
 */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = uuidSchema.parse(req.nextUrl.searchParams.get("chatbotId"))
    const review = req.nextUrl.searchParams.get("scope") === "review"
    await requireChatbotAccess(supabase, user.id, chatbotId, review ? "admin" : "member")
    const admin = getAdminClient()

    if (review) {
      const [pending, published] = await Promise.all([
        admin
          .from("change_alerts")
          .select("id, new_file_id, old_file_id, status, source, score, published_at, created_at")
          .eq("chatbot_id", chatbotId)
          .eq("status", "pending")
          .order("created_at", { ascending: false })
          .limit(50),
        admin
          .from("change_alerts")
          .select("id, new_file_id, old_file_id, status, source, score, published_at, created_at")
          .eq("chatbot_id", chatbotId)
          .eq("status", "published")
          .order("published_at", { ascending: false })
          .limit(10),
      ])
      if (pending.error) throw pending.error
      if (published.error) throw published.error
      return NextResponse.json({
        pending: await withNames(admin, (pending.data ?? []) as AlertRow[]),
        published: await withNames(admin, (published.data ?? []) as AlertRow[]),
      })
    }

    const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()
    const { data: mine, error } = await admin
      .from("change_alert_recipients")
      .select("alert_id")
      .eq("user_id", user.id)
      .is("seen_at", null)
    if (error) throw error
    const alertIds = (mine ?? []).map((r) => r.alert_id)
    if (alertIds.length === 0) return NextResponse.json({ alerts: [] })
    const { data: alerts, error: alertError } = await admin
      .from("change_alerts")
      .select("id, new_file_id, old_file_id, status, source, score, published_at, created_at")
      .eq("chatbot_id", chatbotId)
      .eq("status", "published")
      .gte("published_at", since)
      .in("id", alertIds)
      .order("published_at", { ascending: false })
      .limit(5)
    if (alertError) throw alertError
    return NextResponse.json({ alerts: await withNames(admin, (alerts ?? []) as AlertRow[]) })
  } catch (error) {
    return errorResponse(error, "GET /api/alerts")
  }
}

const bodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("create"),
    chatbotId: uuidSchema,
    newFileId: uuidSchema,
    oldFileId: uuidSchema,
  }),
  z.object({ action: z.literal("preview"), chatbotId: uuidSchema, alertId: uuidSchema }),
  z.object({
    action: z.literal("publish"),
    chatbotId: uuidSchema,
    alertId: uuidSchema,
    // Never e-mails unless the admin asks; even then only people who opted in.
    sendEmails: z.boolean().optional(),
  }),
  z.object({ action: z.literal("dismiss"), chatbotId: uuidSchema, alertId: uuidSchema }),
])

/**
 * Team admins: `create` (declare that a document replaces another; stays
 * pending), `preview` (how many people would be told and e-mailed), `publish`
 * (confirm the replacement and notify) and `dismiss`.
 */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = bodySchema.parse(await req.json())
    const { chatbot } = await requireChatbotAccess(supabase, user.id, body.chatbotId, "admin")
    const admin = getAdminClient()

    if (body.action === "create") {
      if (body.newFileId === body.oldFileId) {
        throw new HttpError(400, "A document cannot replace itself")
      }
      const { data: files, error } = await admin
        .from("files")
        .select("id")
        .eq("chatbot_id", chatbot.id)
        .in("id", [body.newFileId, body.oldFileId])
      if (error) throw error
      if ((files ?? []).length !== 2) throw new HttpError(404, "Document not found in this assistant")
      const { data, error: upsertError } = await admin
        .from("change_alerts")
        .upsert(
          {
            chatbot_id: chatbot.id,
            new_file_id: body.newFileId,
            old_file_id: body.oldFileId,
            source: "manual",
            status: "pending",
            created_by: user.id,
          },
          { onConflict: "new_file_id,old_file_id" }
        )
        .select("id, status")
        .single()
      if (upsertError) throw upsertError
      return NextResponse.json(data)
    }

    const { data: alert, error } = await admin
      .from("change_alerts")
      .select("id, old_file_id, status")
      .eq("id", body.alertId)
      .eq("chatbot_id", chatbot.id)
      .maybeSingle()
    if (error) throw error
    if (!alert) throw new HttpError(404, "Alert not found")

    if (body.action === "preview") {
      const audience = await alertAudience(admin, chatbot, alert.old_file_id)
      return NextResponse.json({
        recipients: audience.recipients.length,
        emailOptIn: audience.emailOptIn.length,
      })
    }

    if (body.action === "dismiss") {
      if (alert.status === "published") throw new HttpError(409, "The alert is already published")
      await admin
        .from("change_alerts")
        .update({ status: "dismissed", decided_by: user.id })
        .eq("id", alert.id)
      return NextResponse.json({ id: alert.id, status: "dismissed" })
    }

    const origin = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, "")
    const result = await publishAlert({
      admin,
      chatbot,
      alertId: alert.id,
      adminId: user.id,
      sendEmails: body.sendEmails === true,
      origin,
    })
    return NextResponse.json({ id: alert.id, status: "published", ...result })
  } catch (error) {
    return errorResponse(error, "POST /api/alerts")
  }
}

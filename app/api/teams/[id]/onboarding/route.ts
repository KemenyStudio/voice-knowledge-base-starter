import { NextRequest, NextResponse } from "next/server"

import { parseUuid, requireTeamRole } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import type { OnboardingStep } from "@/lib/onboarding"
import { getAdminClient, requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

/**
 * Progress of a new team through the first steps: create an assistant, upload
 * documents, invite a teammate, ask a first question. Any team member can read
 * it; the checklist itself is only shown to admins.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { supabase, user } = await requireUser()
    const teamId = parseUuid(params.id)
    await requireTeamRole(supabase, teamId, user.id, "member")
    const admin = getAdminClient()

    const { data: chatbots, error: chatbotsError } = await admin
      .from("chatbots")
      .select("id")
      .eq("team_id", teamId)
    if (chatbotsError) throw chatbotsError
    const chatbotIds = (chatbots ?? []).map((c: { id: string }) => c.id)

    const count = async (query: PromiseLike<{ count: number | null; error: unknown }>) => {
      const { count: total, error } = await query
      if (error) throw error
      return total ?? 0
    }

    const [documents, members, invitations, questions] = await Promise.all([
      chatbotIds.length
        ? count(
            admin
              .from("files")
              .select("id", { count: "exact", head: true })
              .in("chatbot_id", chatbotIds)
          )
        : 0,
      count(
        admin
          .from("team_members")
          .select("id", { count: "exact", head: true })
          .eq("team_id", teamId)
      ),
      count(
        admin
          .from("invitations")
          .select("id", { count: "exact", head: true })
          .eq("team_id", teamId)
      ),
      chatbotIds.length
        ? count(
            admin
              .from("chat_messages")
              .select("id", { count: "exact", head: true })
              .in("chatbot_id", chatbotIds)
              .eq("role", "user")
          )
        : 0,
    ])

    const steps: OnboardingStep[] = [
      { id: "assistant", done: chatbotIds.length > 0 },
      { id: "documents", done: documents > 0 },
      { id: "teammate", done: members > 1 || invitations > 0 },
      { id: "question", done: questions > 0 },
    ]
    return NextResponse.json({
      steps,
      complete: steps.every((s) => s.done),
      firstChatbotId: chatbotIds[0] ?? null,
    })
  } catch (error) {
    return errorResponse(error, "GET /api/teams/[id]/onboarding")
  }
}

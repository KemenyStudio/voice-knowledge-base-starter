// app/actions/user.ts
"use server";

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs";
import { cookies } from "next/headers";

/**
 * Where to send a user right after sign-in.
 * - exactly one assistant across all their teams -> that assistant
 * - otherwise (none or several) -> null, so the caller opens the dashboard
 */
export async function getDefaultChatbot(): Promise<{ id: string } | null> {
  const supabase = createServerComponentClient({ cookies });

  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return null;

    // RLS (and the explicit team filter) limit this to the user's own teams.
    const { data: memberships, error: membershipError } = await supabase
      .from("team_members")
      .select("team_id")
      .eq("user_id", user.id);
    if (membershipError) throw membershipError;

    const teamIds = (memberships ?? []).map((m) => m.team_id);
    if (teamIds.length === 0) return null;

    const { data: chatbots, error } = await supabase
      .from("chatbots")
      .select("id")
      .in("team_id", teamIds)
      .limit(2);
    if (error) throw error;

    return chatbots && chatbots.length === 1 ? { id: String(chatbots[0].id) } : null;
  } catch (error) {
    console.error("Server Action Error:", error);
    return null;
  }
}

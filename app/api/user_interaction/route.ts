import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { HttpError, errorResponse } from "@/lib/http"
import { requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  responseId: z.string().min(1).max(200),
  rating: z.union([z.literal(1), z.literal(-1)]),
  comment: z.string().trim().max(2000).optional(),
})

/** Thumbs up/down (with optional comment) on one of the caller's own answers. */
export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const { responseId, rating, comment } = bodySchema.parse(await req.json())

    // RLS also enforces this; checking here gives a proper 404.
    const { data: message, error: messageError } = await supabase
      .from("chat_messages")
      .select("id")
      .eq("id", responseId)
      .eq("user_id", user.id)
      .eq("role", "assistant")
      .maybeSingle()
    if (messageError) throw messageError
    if (!message) throw new HttpError(404, "Answer not found")

    const { error } = await supabase.from("answer_ratings").upsert({
      message_id: responseId,
      user_id: user.id,
      rating,
      comment: comment || null,
    })
    if (error) throw error

    return NextResponse.json({ success: true }, { status: 201 })
  } catch (error) {
    return errorResponse(error, "POST /api/user_interaction")
  }
}

import { NextRequest, NextResponse } from "next/server"

import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import { errorResponse } from "@/lib/http"
import { buildInfraStatus } from "@/lib/infra/status"
import { requireUser } from "@/lib/supabase/server"

export const dynamic = "force-dynamic"

/** Which services this process can call. Team admins only. No secret values. */
export async function GET(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const chatbotId = uuidSchema.parse(req.nextUrl.searchParams.get("chatbotId"))
    await requireChatbotAccess(supabase, user.id, chatbotId, "admin")
    return NextResponse.json(buildInfraStatus(process.env))
  } catch (error) {
    return errorResponse(error, "GET /api/infra")
  }
}

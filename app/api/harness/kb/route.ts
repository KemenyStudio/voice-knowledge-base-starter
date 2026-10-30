import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { answerFixture } from "@/lib/computer/retrieve"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  question: z.string().trim().min(1).max(2000),
})

function loopbackHost(request: NextRequest): boolean {
  const host = request.headers.get("host") ?? ""
  const name = host.replace(/^\[|\]$/g, "").split(":")[0]
  return name === "localhost" || name === "127.0.0.1" || name === "::1"
}

/**
 * Answers from the isolated fixture corpus (or one dedicated vector store).
 * It does not read the team library and it does not accept a store id.
 */
export async function POST(request: NextRequest) {
  if (process.env.COMPUTER_USE_FIXTURE !== "1") {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }
  if (!loopbackHost(request)) {
    return NextResponse.json({ error: "Loopback only" }, { status: 403 })
  }
  const json = await request.json().catch(() => null)
  const parsed = bodySchema.safeParse(json)
  if (!parsed.success) {
    return NextResponse.json({ error: "Question is required" }, { status: 400 })
  }
  try {
    const answer = await answerFixture(parsed.data.question)
    return NextResponse.json(answer)
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed"
    return NextResponse.json({ error: message }, { status: 502 })
  }
}

import { NextRequest, NextResponse } from "next/server"
import { z } from "zod"

import { uuidSchema } from "@/lib/auth/access"
import { HttpError, errorResponse } from "@/lib/http"
import { loadVoiceContext } from "@/lib/voice/context"
import {
  CLIENT_SECRET_TTL_SECONDS,
  buildRealtimeSession,
  buildVoiceInstructions,
} from "@/lib/voice/instructions"
import { REALTIME_CLIENT_SECRETS_URL, realtimeSecretHeaders } from "@/lib/voice/secret"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  chatbotId: uuidSchema,
})

/**
 * Mints a short-lived Realtime client secret for a signed-in member.
 * The OpenAI API key stays on the server. The session is pinned to Spanish
 * and to the library tools. buscar_biblioteca searches this assistant's vector store.
 */
export async function POST(req: NextRequest) {
  try {
    const body = bodySchema.parse(await req.json())
    const { userId, chatbot, entity, options, callSettings } = await loadVoiceContext(
      body.chatbotId
    )
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new HttpError(503, "La llamada no está configurada.")

    const session = buildRealtimeSession({
      instructions: buildVoiceInstructions(chatbot, entity, callSettings),
      entityOptions: options,
      navigation: callSettings.navigation,
    })

    const minted = await fetch(REALTIME_CLIENT_SECRETS_URL, {
      method: "POST",
      headers: realtimeSecretHeaders(apiKey, userId),
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: CLIENT_SECRET_TTL_SECONDS },
        session,
      }),
    })

    if (!minted.ok) {
      console.error("POST /api/voice/session openai", minted.status)
      throw new HttpError(502, "No se pudo iniciar la llamada.")
    }

    const secret = readClientSecret(await minted.json())
    if (!secret) throw new HttpError(502, "No se pudo iniciar la llamada.")

    return NextResponse.json({
      clientSecret: secret.value,
      expiresAt: secret.expiresAt,
      voice: session.audio.output.voice,
      model: session.model,
    })
  } catch (error) {
    return errorResponse(error, "POST /api/voice/session")
  }
}

function readClientSecret(data: unknown): { value: string; expiresAt: number | null } | null {
  if (!data || typeof data !== "object") return null
  const row = data as Record<string, unknown>
  const nested = row.client_secret
  const nestedValue =
    nested && typeof nested === "object"
      ? (nested as Record<string, unknown>).value
      : undefined
  const value =
    typeof row.value === "string"
      ? row.value
      : typeof nestedValue === "string"
        ? nestedValue
        : null
  // Never hand the project key to the browser, even if the payload is unexpected.
  const projectKeyPrefix = ["sk", ""].join("-")
  if (!value || value.startsWith(projectKeyPrefix)) return null
  const expiresAt = typeof row.expires_at === "number" ? row.expires_at : null
  return { value, expiresAt }
}

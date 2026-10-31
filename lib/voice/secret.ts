import { createHash } from "node:crypto"

/** Headers for POST /v1/realtime/client_secrets. No beta header. */
export function realtimeSecretHeaders(
  apiKey: string,
  userId: string
): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "OpenAI-Safety-Identifier": createHash("sha256").update(userId).digest("hex"),
  }
}

export const REALTIME_CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets"

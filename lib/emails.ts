import { Resend } from "resend"

/** Address Resend sends from. Set EMAIL_FROM to an address on your verified domain. */
export function emailFromAddress(env: NodeJS.ProcessEnv = process.env): string {
  const raw = env.EMAIL_FROM?.trim() ?? ""
  const plain = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/
  const named = /^[^<>]+<[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+>$/
  if (plain.test(raw) || named.test(raw)) return raw
  return "Document Search <onboarding@example.com>"
}

let client: Resend | null = null

/** Lazy singleton: importing this module never throws when the key is absent (preview builds). */
function getResend(): Resend {
  if (!client) {
    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) throw new Error("RESEND_API_KEY is not set")
    client = new Resend(apiKey)
  }
  return client
}

export const sendEmail = async ({
  to,
  subject,
  html,
}: {
  to: string
  subject: string
  html: string
}) => {
  try {
    const data = await getResend().emails.send({
      from: emailFromAddress(),
      to,
      subject,
      html,
    })
    return { success: true, data }
  } catch (error) {
    return { success: false, error }
  }
}

import { createServerComponentClient } from "@supabase/auth-helpers-nextjs"
import { cookies } from "next/headers"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"

import SharedConversation, {
  type SharedMessage,
} from "@/components/chat/SharedConversation"
import { Button } from "@/components/ui/button"
import { uuidSchema } from "@/lib/auth/access"

export const dynamic = "force-dynamic"

/**
 * Read-only copy of a conversation. Needs a session and membership of the
 * assistant's team (enforced by RLS and re-checked here).
 */
export default async function SharedConversationPage({
  params,
}: {
  params: { id: string }
}) {
  if (!uuidSchema.safeParse(params.id).success) notFound()

  const supabase = createServerComponentClient({ cookies })
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=${encodeURIComponent(`/shared/${params.id}`)}`)

  const { data: share, error } = await supabase
    .from("conversation_shares")
    .select("id, title, messages, created_at, chatbot_id")
    .eq("id", params.id)
    .maybeSingle()
  if (error) {
    console.error("shared conversation", error)
    return <div className="p-8">No se pudo cargar la conversación.</div>
  }
  if (!share) notFound()

  const { data: chatbot } = await supabase
    .from("chatbots")
    .select("id, name, team_id")
    .eq("id", share.chatbot_id)
    .maybeSingle()
  if (!chatbot) notFound()

  const { data: membership } = await supabase
    .from("team_members")
    .select("role")
    .eq("team_id", chatbot.team_id)
    .eq("user_id", user.id)
    .maybeSingle()
  if (!membership) notFound()

  return (
    <div className="mx-auto min-h-[100dvh] w-full max-w-3xl px-4 py-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] md:p-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground">
            Conversación compartida · {chatbot.name} ·{" "}
            {new Date(share.created_at).toLocaleDateString("es-MX")}
          </p>
          <h1 className="truncate text-2xl font-bold">
            {share.title || "Conversación"}
          </h1>
        </div>
        <Button asChild variant="outline">
          <Link href={`/chatbot/${chatbot.id}`}>Abrir el asistente</Link>
        </Button>
      </div>
      <SharedConversation messages={share.messages as SharedMessage[]} />
    </div>
  )
}

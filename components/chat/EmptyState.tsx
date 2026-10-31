"use client"

import { defaultWelcomeMessage } from "@/app/config/assistant-defaults"
import { EntityPrompt } from "@/components/chat/EntityPicker"
import { emptyChatGroups } from "@/lib/chat/suggested"
import type { KnowledgeOverview } from "@/lib/knowledge/overview"
import type { Chatbot } from "@/types/chatbot"

/** Welcome line, document count and a few short example questions. */
export function EmptyState({
  chatbot,
  onSelect,
  entityPrompt,
  knowledge,
}: {
  chatbot: Chatbot | null
  onSelect: (prompt: string) => void
  /** Asks for the user's entity type when the assistant has some and none is saved. */
  entityPrompt?: {
    options: string[]
    onPick: (entity: string) => void
    onDismiss: () => void
  } | null
  /** What the assistant knows, shown under the welcome text. */
  knowledge?: KnowledgeOverview | null
}) {
  const groups = emptyChatGroups(chatbot?.suggested_questions ?? [])
  const welcome =
    chatbot?.welcome_message?.trim() ||
    defaultWelcomeMessage(chatbot?.name ?? "")
  const documents = knowledge?.documents

  return (
    <div className="mb-4 w-full min-w-0 space-y-4">
      <p className="text-sm leading-6 text-zinc-700 dark:text-zinc-300">{welcome}</p>
      {typeof documents === "number" && (
        <p className="text-xs text-muted-foreground" data-testid="knowledge-summary">
          {documents.toLocaleString("es")}{" "}
          {documents === 1 ? "documento" : "documentos"}
        </p>
      )}
      {entityPrompt && <EntityPrompt {...entityPrompt} />}
      {groups.length > 0 && (
        <div className="space-y-3">
          {groups.map((group) => (
            <div key={group.category} className="min-w-0 space-y-0.5">
              <p className="px-1 text-xs font-normal text-zinc-500">{group.category}</p>
              <div className="flex min-w-0 flex-col">
                {group.prompts.map((prompt) => (
                  <button
                    key={`${group.category}:${prompt}`}
                    type="button"
                    title={prompt}
                    className="flex h-11 w-full items-center rounded-md px-1 text-left text-sm text-zinc-800 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-white/5 sm:h-9"
                    onClick={() => onSelect(prompt)}
                  >
                    <span className="truncate">{prompt}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

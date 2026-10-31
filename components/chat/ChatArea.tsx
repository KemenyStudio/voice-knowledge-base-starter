"use client"

import { memo, useEffect, useMemo, useRef } from "react"
import { Loader2, Menu, MessageSquare, Send, Square, SquarePen, Telescope } from "lucide-react"

import { normalizeTools, type ToolId } from "@/lib/tools/registry"
import { ResearchSteps, type ResearchStep } from "@/components/chat/ResearchSteps"
import { motion } from "framer-motion"

import { ClarifyOptions, EntityFilterNote } from "@/components/chat/ClarifyOptions"
import { EmptyState } from "@/components/chat/EmptyState"
import { EntityChip } from "@/components/chat/EntityPicker"
import { FollowUps } from "@/components/chat/FollowUps"
import { Response } from "@/components/chat/Response"
import {
  folderSlug,
  QuestionActions,
  ThreadOutline,
} from "@/components/chat/ThreadOrganize"
import type { ChatMessage } from "@/components/chat/types"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { locationCaption, type PassageContext } from "@/lib/chat/passage"
import { cn } from "@/lib/utils"
import type { SourceItem } from "@/components/chat/Sources"
import type { DocumentAction } from "@/lib/document-actions"
import type { KnowledgeOverview } from "@/lib/knowledge/overview"
import type { Chatbot } from "@/types/chatbot"

export type SearchPhase = "thinking" | "searching"

interface ChatAreaProps {
  messages: ChatMessage[]
  input: string
  setInput: (value: string) => void
  onSend: (message?: string) => void
  onStop: () => void
  onRetry: () => void
  onNewConversation: () => void
  getSessionId: () => string | null
  isSearching: boolean
  searchPhase: SearchPhase
  messagesEndRef: React.RefObject<HTMLDivElement>
  chatbot: Chatbot | null
  selectedCitation?: number | null
  onCitationClick?: (citationNumber: number | null) => void
  /** Entity type remembered for this user (null = unknown). */
  entity: string | null
  entityOptions: string[]
  showEntityPrompt: boolean
  onEntityChange: (entity: string | null) => void
  onEntityDismiss: () => void
  onClarifyPick: (option: string, kind?: "entity_type") => void
  onSearchAll: () => void
  knowledge?: KnowledgeOverview | null
  onDocumentAction?: (action: DocumentAction, source: SourceItem) => void
  /** Rendered above the welcome text of an empty chat (change alerts). */
  emptyStateExtra?: React.ReactNode
  researchAvailable?: boolean
  researchMode?: boolean
  onResearchModeChange?: (value: boolean) => void
  /** Live searches of an "Investigar a fondo" question. */
  researchProgress?: ResearchStep[] | null
  /** Phone: opens the navigation drawer. Hidden from sm and up. */
  onOpenMenu?: () => void
  onEditQuestion?: (messageId: string, text: string) => void
  onPlaceMessage?: (
    messageId: string,
    patch: { pinned?: boolean; setFolder?: boolean; folder?: string | null }
  ) => void
  /** Passage that will be sent with the next question. */
  passage?: PassageContext | null
  onClearPassage?: () => void
}

export const ChatArea = memo(function ChatArea({
  messages,
  input,
  setInput,
  onSend,
  onStop,
  onRetry,
  onNewConversation,
  getSessionId,
  isSearching,
  searchPhase,
  messagesEndRef,
  chatbot,
  selectedCitation,
  onCitationClick,
  entity,
  entityOptions,
  showEntityPrompt,
  onEntityChange,
  onEntityDismiss,
  onClarifyPick,
  onSearchAll,
  knowledge,
  onDocumentAction,
  emptyStateExtra,
  researchAvailable = false,
  researchMode = false,
  onResearchModeChange,
  researchProgress = null,
  onOpenMenu,
  onEditQuestion,
  onPlaceMessage,
  passage = null,
  onClearPassage,
}: ChatAreaProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const enabledTools = useMemo(
    () => normalizeTools(chatbot?.enabled_tools),
    [chatbot?.enabled_tools]
  )
  const folders = useMemo(() => {
    const names: string[] = []
    for (const message of messages) {
      if (message.folder && !names.includes(message.folder)) names.push(message.folder)
    }
    return names
  }, [messages])

  const topRef = useRef<HTMLDivElement>(null)
  const isEmpty = messages.length === 0
  useEffect(() => {
    // A new conversation starts at the top, where the notices are.
    if (isEmpty) topRef.current?.scrollIntoView({ block: "start" })
  }, [isEmpty])

  useEffect(() => {
    if (passage) inputRef.current?.focus()
  }, [passage])

  useEffect(() => {
    const focusOnType = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (e.key.length > 1) return
      const active = document.activeElement
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLButtonElement
      ) {
        return
      }
      inputRef.current?.focus()
    }
    window.addEventListener("keydown", focusOnType)
    return () => window.removeEventListener("keydown", focusOnType)
  }, [])

  const lastIndex = messages.length - 1
  const lastMessage = messages[lastIndex]
  const followUps =
    !isSearching && lastMessage?.role === "assistant" && !lastMessage.error
      ? lastMessage.followUps ?? []
      : []
  const clarify =
    !isSearching && lastMessage?.role === "assistant" ? lastMessage.clarify : undefined
  const filterNote =
    !isSearching &&
    lastMessage?.role === "assistant" &&
    !lastMessage.error &&
    !lastMessage.clarify &&
    lastMessage.entityFilter?.applied
      ? lastMessage.entityFilter.entity
      : null

  return (
    <motion.div
      className="flex h-full min-h-0 w-full flex-col bg-white text-zinc-900 dark:bg-[#1e1e1e] dark:text-zinc-100"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.25 }}
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-zinc-200 px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] dark:border-white/10 sm:px-8 sm:py-2.5">
        <div className="flex min-w-0 items-center gap-1">
          {onOpenMenu && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={onOpenMenu}
              className="h-11 w-11 shrink-0 text-zinc-600 dark:text-zinc-300 sm:hidden"
              aria-label="Abrir menú"
            >
              <Menu className="h-5 w-5" />
            </Button>
          )}
          <h1 className="flex min-w-0 items-center gap-2 text-sm font-medium tracking-tight text-zinc-600 dark:text-zinc-300">
            <MessageSquare className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="truncate">{chatbot?.name ?? "Chat"}</span>
          </h1>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <EntityChip
            entity={entity}
            options={entityOptions}
            onChange={onEntityChange}
          />
          <Button
            variant="ghost"
            size="sm"
            onClick={onNewConversation}
            className="h-11 text-muted-foreground hover:text-foreground sm:h-8"
            aria-label="Nueva conversación"
            title="Nueva conversación"
          >
            <SquarePen className="mr-2 h-4 w-4" />
            Nueva
          </Button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-3xl px-3 py-6 sm:px-8 sm:py-8">
          <div ref={topRef} />
          {messages.length === 0 && emptyStateExtra}
          {messages.length === 0 && (
            <EmptyState
              chatbot={chatbot}
              knowledge={knowledge}
              onSelect={(prompt) => onSend(prompt)}
              entityPrompt={
                showEntityPrompt
                  ? {
                      options: entityOptions,
                      onPick: onEntityChange,
                      onDismiss: onEntityDismiss,
                    }
                  : null
              }
            />
          )}
          {messages.length > 0 && <ThreadOutline messages={messages} />}
          {messages.map((message, index) => {
            const showFolder =
              message.role === "user" &&
              Boolean(message.folder) &&
              previousUserFolder(messages, index) !== message.folder
            return (
              <div key={message.id ?? `${index}-${message.role}`}>
                {showFolder && message.folder && (
                  <h2
                    id={`folder-${folderSlug(message.folder)}`}
                    className="mb-3 mt-2 scroll-mt-6 text-xs font-semibold uppercase tracking-wide text-zinc-500"
                  >
                    {message.folder}
                  </h2>
                )}
                <MessageItem
                  message={message}
                  turnIndex={index}
                  question={
                    message.role === "assistant"
                      ? previousUserMessage(messages, index)
                      : undefined
                  }
                  chatbotId={chatbot?.id}
                  getSessionId={getSessionId}
                  selectedCitation={selectedCitation}
                  onCitationClick={onCitationClick}
                  onRetry={index === lastIndex ? onRetry : undefined}
                  onDocumentAction={onDocumentAction}
                  tools={enabledTools}
                  folders={folders}
                  isSearching={isSearching}
                  onEditQuestion={onEditQuestion}
                  onPlaceMessage={onPlaceMessage}
                />
              </div>
            )
          })}
          {isSearching && (
            <LoadingMessage phase={searchPhase} research={researchProgress} />
          )}
          {clarify && (
            <ClarifyOptions
              options={clarify.options}
              onSelect={(option) => onClarifyPick(option, clarify.kind)}
            />
          )}
          {filterNote && (
            <EntityFilterNote entity={filterNote} onSearchAll={onSearchAll} />
          )}
          <FollowUps
            questions={followUps}
            onSelect={(question) => onSend(question)}
          />
          <div ref={messagesEndRef} className="h-6" />
        </div>
      </div>

      <ChatInput
        input={input}
        setInput={setInput}
        onSend={onSend}
        onStop={onStop}
        isSearching={isSearching}
        inputRef={inputRef}
        assistantName={chatbot?.name}
        researchAvailable={researchAvailable}
        researchMode={researchMode}
        onResearchModeChange={onResearchModeChange}
        passage={passage}
        onClearPassage={onClearPassage}
      />
    </motion.div>
  )
})

function previousUserMessage(messages: ChatMessage[], index: number) {
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].content
  }
  return undefined
}

function previousUserFolder(messages: ChatMessage[], index: number) {
  for (let i = index - 1; i >= 0; i--) {
    if (messages[i].role === "user") return messages[i].folder ?? null
  }
  return null
}

function ChatInput({
  input,
  setInput,
  onSend,
  onStop,
  isSearching,
  inputRef,
  assistantName,
  researchAvailable,
  researchMode,
  onResearchModeChange,
  passage,
  onClearPassage,
}: {
  input: string
  setInput: (value: string) => void
  onSend: (message?: string) => void
  onStop: () => void
  isSearching: boolean
  inputRef: React.RefObject<HTMLTextAreaElement>
  assistantName?: string
  researchAvailable?: boolean
  researchMode?: boolean
  onResearchModeChange?: (value: boolean) => void
  passage?: PassageContext | null
  onClearPassage?: () => void
}) {
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (!isSearching) onSend()
    }
  }

  return (
    <div className="shrink-0 border-t border-zinc-200 bg-white pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-white/10 dark:bg-[#1e1e1e]">
      <div className="mx-auto w-full max-w-3xl px-3 py-3 sm:px-8">
        {passage && (
          <div
            data-testid="passage-context"
            className="mb-2 flex items-start justify-between gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 dark:border-white/10 dark:bg-[#2a2a2a]"
          >
            <p className="text-xs leading-5 text-zinc-700 dark:text-zinc-300">
              La próxima pregunta usará este fragmento de «{passage.title}».{" "}
              {locationCaption(passage.location)}.
            </p>
            <button
              type="button"
              onClick={onClearPassage}
              className="shrink-0 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
            >
              Quitar
            </button>
          </div>
        )}
        {researchAvailable && !isSearching && (
          <div className="mb-2 flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={researchMode}
              data-testid="research-toggle"
              onClick={() => onResearchModeChange?.(!researchMode)}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                researchMode
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
              title="Planea varias búsquedas y redacta una respuesta más completa. Tarda más."
            >
              <Telescope className="h-3.5 w-3.5" />
              Investigar a fondo
            </button>
            {researchMode && (
              <span className="text-xs text-muted-foreground">
                Solo para la próxima pregunta; tarda más.
              </span>
            )}
          </div>
        )}
        <div className="flex items-end gap-2 rounded-xl border border-zinc-200 bg-zinc-100 p-1.5 focus-within:border-zinc-300 dark:border-white/10 dark:bg-[#2a2a2a] dark:focus-within:border-white/20">
          <Textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              researchMode
                ? "Haz una pregunta amplia, por ejemplo: compara los requisitos..."
                : "Escribe tu pregunta..."
            }
            className="max-h-[160px] min-h-[44px] flex-grow resize-none border-0 bg-transparent px-2 py-2 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
            onKeyDown={onKeyDown}
            rows={1}
          />
          {isSearching ? (
            <Button
              onClick={onStop}
              size="icon"
              variant="outline"
              className="mb-0.5 h-11 w-11 shrink-0 rounded-xl sm:h-9 sm:w-9"
              aria-label="Detener respuesta"
              title="Detener respuesta"
            >
              <Square className="h-4 w-4 fill-current" />
            </Button>
          ) : (
            <Button
              onClick={() => onSend()}
              disabled={!input.trim()}
              size="icon"
              className="mb-0.5 h-11 w-11 shrink-0 rounded-xl sm:h-9 sm:w-9"
              aria-label="Enviar"
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        <p className="mt-2 text-center text-[11px] leading-4 text-muted-foreground">
          {assistantName ?? "El asistente"} puede cometer errores. Verifica la
          información recibida.
        </p>
      </div>
    </div>
  )
}

interface MessageItemProps {
  message: ChatMessage
  turnIndex: number
  question?: string
  chatbotId?: string
  getSessionId: () => string | null
  selectedCitation?: number | null
  onCitationClick?: (citationNumber: number | null) => void
  onRetry?: () => void
  onDocumentAction?: (action: DocumentAction, source: SourceItem) => void
  tools?: ToolId[]
  folders: string[]
  isSearching: boolean
  onEditQuestion?: (messageId: string, text: string) => void
  onPlaceMessage?: (
    messageId: string,
    patch: { pinned?: boolean; setFolder?: boolean; folder?: string | null }
  ) => void
}

const MessageItem = memo(function MessageItem({
  message,
  turnIndex,
  question,
  chatbotId,
  getSessionId,
  selectedCitation,
  onCitationClick,
  onRetry,
  onDocumentAction,
  tools,
  folders,
  isSearching,
  onEditQuestion,
  onPlaceMessage,
}: MessageItemProps) {
  const isUser = message.role === "user"

  if (isUser) {
    return (
      <motion.div
        id={`chat-turn-${turnIndex}`}
        className="mb-6 flex scroll-mt-6 justify-end"
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className="flex max-w-[40rem] flex-col items-end">
          <p className="whitespace-pre-wrap text-sm font-medium leading-6 text-zinc-600 dark:text-zinc-400">
            {message.content}
          </p>
          {message.passage && (
            <p className="mt-1 max-w-md text-right text-xs leading-5 text-zinc-500">
              Sobre un fragmento de {message.passage.title}.{" "}
              {locationCaption(message.passage.location)}.
            </p>
          )}
          {onEditQuestion && onPlaceMessage && (
            <QuestionActions
              message={message}
              folders={folders}
              disabled={isSearching}
              onEdit={onEditQuestion}
              onPlace={onPlaceMessage}
            />
          )}
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      className="mb-8 min-w-0"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      {message.clarify ? (
        <p className="whitespace-pre-wrap text-[15.5px] leading-7" data-testid="clarify-question">
          {message.content}
        </p>
      ) : (
        <Response
          message={message}
          question={question}
          chatbotId={chatbotId}
          getSessionId={getSessionId}
          selectedCitation={selectedCitation}
          onCitationClick={onCitationClick}
          onRetry={onRetry}
          onDocumentAction={onDocumentAction}
          tools={tools}
        />
      )}
    </motion.div>
  )
})

const LoadingMessage = memo(function LoadingMessage({
  phase,
  research,
}: {
  phase: SearchPhase
  research?: ResearchStep[] | null
}) {
  return (
    <motion.div
      className="mb-8 text-sm text-muted-foreground"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div>
        {research ? (
          <div className="min-w-[260px]">
            {research.length === 0 ? (
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Planeando las búsquedas...</span>
              </div>
            ) : (
              <ResearchSteps
                steps={research}
                writing={research.every((s) => s.status === "done")}
              />
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>
              {phase === "searching"
                ? "Buscando en los documentos..."
                : "Pensando..."}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  )
})

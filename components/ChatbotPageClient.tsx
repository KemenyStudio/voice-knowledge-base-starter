"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"
import { AnimatePresence, motion } from "framer-motion"
import { ChevronsLeft, ChevronsRight, Menu, PanelLeftOpen } from "lucide-react"

import { checkTeamAdmin } from "@/app/actions/team"
import AssistantSettings from "@/components/AssistantSettings"
import BibliotecaView from "@/components/BibliotecaView"
import { ChatArea, type SearchPhase } from "@/components/chat/ChatArea"
import { ChangeAlerts, type ChangeAlert } from "@/components/chat/ChangeAlerts"
import { DocumentActionPicker } from "@/components/chat/DocumentActionPicker"
import type { ResearchStep } from "@/components/chat/ResearchSteps"
import type { SourceItem } from "@/components/chat/Sources"
import {
  actionQuestion,
  type DocumentAction,
} from "@/lib/document-actions"
import { HistoryView } from "@/components/chat/HistoryView"
import { VoiceSessionProvider } from "@/components/chat/VoiceCall"
import { ProfileView } from "@/components/chat/ProfileView"
import { ResultsArea, type Result } from "@/components/chat/ResultsPanel"
import type { ChatMessage } from "@/components/chat/types"
import FeedbackView from "@/components/feedback-view"
import InfraestructuraView from "@/components/InfraestructuraView"
import UsageView from "@/components/UsageView"
import { useToast } from "@/hooks/use-toast"
import Sidebar from "@/components/sidebar"
import TeamPageClient from "@/components/TeamPageClient"
import { Button } from "@/components/ui/button"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { TooltipProvider } from "@/components/ui/tooltip"
import { formatReferences } from "@/app/utils/formatReferences"
import { EMPTY_LOCATION, readPassage, type PassageContext } from "@/lib/chat/passage"
import { readEvents, type StreamDone, type StreamEvent } from "@/lib/chat/stream"
import type { KnowledgeOverview } from "@/lib/knowledge/overview"
import type { Chatbot } from "@/types/chatbot"
import type { Team } from "@/types/team"
import type { ChatCitation } from "@/types/knowledge"
import {
  parseVoiceLength,
  parseVoiceNavigation,
  type VoiceLength,
  type VoiceNavigation,
} from "@/lib/voice/call-settings"

import "katex/dist/katex.min.css"

const useMediaQuery = (query: string): boolean => {
  const [matches, setMatches] = useState(false)

  useEffect(() => {
    const media = window.matchMedia(query)
    setMatches(media.matches)
    const listener = () => setMatches(media.matches)
    media.addEventListener("change", listener)
    return () => media.removeEventListener("change", listener)
  }, [query])

  return matches
}

const sessionStorageKey = (chatbotId: string | undefined) =>
  `session_id:${chatbotId ?? "none"}`

/** "1" means the desktop nav is hidden. Session-only, so a new tab starts open. */
const NAV_SIDEBAR_HIDDEN_KEY = "nav-sidebar-hidden"

function readNavSidebarHidden(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.sessionStorage.getItem(NAV_SIDEBAR_HIDDEN_KEY) === "1"
  } catch {
    return false
  }
}

function writeNavSidebarHidden(hidden: boolean) {
  try {
    window.sessionStorage.setItem(NAV_SIDEBAR_HIDDEN_KEY, hidden ? "1" : "0")
  } catch {
    // Private mode can block storage. The choice still applies for this visit.
  }
}

/** Citations the answer actually refers to as [N]. */
function citedCitations(content: string, citations: ChatCitation[]) {
  const cited = new Set(
    Array.from(content.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]))
  )
  return citations.filter((c) => cited.has(c.number))
}

function toResults(citations: ChatCitation[]): Result[] {
  return citations.map((c) => ({
    number: c.number,
    title: c.title,
    extract: c.text,
    url: c.file_url ?? "",
    location: c.location ?? { ...EMPTY_LOCATION },
  }))
}

interface TranscriptRow {
  id: string
  role: "user" | "assistant"
  content: string
  pinned?: boolean
  folder?: string | null
  citations?: ChatCitation[]
  meta?: {
    follow_ups?: string[]
    clarify?: ChatMessage["clarify"]
    entity_filter?: ChatMessage["entityFilter"]
    research?: ChatMessage["research"]
    web_sources?: ChatMessage["webSources"]
    passage?: PassageContext
  }
}

export default function ChatbotPageClient({
  chatbot: initialChatbot,
}: {
  chatbot: Chatbot | null
}) {
  const [chatbot, setChatbot] = useState<Chatbot | null>(initialChatbot)
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [isSearching, setIsSearching] = useState(false)
  const [searchPhase, setSearchPhase] = useState<SearchPhase>("thinking")
  const [team, setTeam] = useState<Team | null>(null)
  const [selectedCitation, setSelectedCitation] = useState<number | null>(null)
  const [knowledge, setKnowledge] = useState<KnowledgeOverview | null>(null)
  const [entity, setEntity] = useState<string | null>(null)
  const [entityDismissed, setEntityDismissed] = useState(true)
  const [emailAlerts, setEmailAlerts] = useState(false)
  const [voiceLength, setVoiceLength] = useState<VoiceLength>("normal")
  const [voiceNavigation, setVoiceNavigation] = useState<VoiceNavigation>("app")
  const [researchMode, setResearchMode] = useState(false)
  const [researchProgress, setResearchProgress] = useState<ResearchStep[] | null>(null)
  const [passageFocus, setPassageFocus] = useState<PassageContext | null>(null)

  const [results, setResults] = useState<Result[]>([])
  const [currentView, setCurrentView] = useState("chat")
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const [isNavHidden, setIsNavHidden] = useState(false)
  const [isDrawerOpen, setIsDrawerOpen] = useState(true)
  const [panelLayout, setPanelLayout] = useState([78, 22])
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Bumped whenever the conversation changes, so a slow history load never
  // overwrites what the user did in the meantime.
  const conversationEpoch = useRef(0)
  const isMobile = useMediaQuery("(max-width: 768px)")

  const router = useRouter()
  const supabase = createClientComponentClient()

  useEffect(() => {
    const savedLayout = localStorage.getItem("panelLayout")
    if (savedLayout) setPanelLayout(JSON.parse(savedLayout))
  }, [])

  useLayoutEffect(() => {
    setIsNavHidden(readNavSidebarHidden())
  }, [])

  const hideNav = useCallback(() => {
    setIsNavHidden(true)
    writeNavSidebarHidden(true)
  }, [])

  const showNav = useCallback(() => {
    setIsNavHidden(false)
    writeNavSidebarHidden(false)
  }, [])

  useEffect(() => {
    if (!initialChatbot) return
    const fetchTeam = async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*")
        .eq("id", initialChatbot.team_id)
        .single()
      if (error || !data || typeof data !== "object" || !("id" in data)) {
        console.error("Error fetching team:", error)
        return
      }
      setTeam(data)
    }
    fetchTeam()
  }, [initialChatbot, supabase])

  useEffect(() => {
    if (team) checkTeamAdmin(team.id).then(setIsAdmin)
  }, [team])

  const messageCountRef = useRef(0)
  useEffect(() => {
    const count = messages.length
    const grew = count > messageCountRef.current
    messageCountRef.current = count
    if (!grew || count === 0) return
    // Keep the latest question at the top of the reading column so a long
    // answer is not pushed off by follow-ups at the bottom.
    let index = count - 1
    if (messages[index]?.role !== "user") {
      for (let i = index - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          index = i
          break
        }
      }
    }
    document.getElementById(`chat-turn-${index}`)?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    })
  }, [messages])

  const entityOptions = chatbot?.audience_options ?? []
  const researchAvailable = chatbot?.research_enabled !== false

  useEffect(() => {
    setKnowledge(null)
    if (!chatbot) return
    let cancelled = false
    fetch(`/api/chatbots/${chatbot.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.knowledge) setKnowledge(data.knowledge)
      })
      .catch((error) => console.error("Error loading overview:", error))
    return () => {
      cancelled = true
    }
  }, [chatbot?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // What the assistant remembers about this user (entity type).
  useEffect(() => {
    setEntity(null)
    setEntityDismissed(true)
    setEmailAlerts(false)
    setVoiceLength("normal")
    setVoiceNavigation("app")
    if (!chatbot) return
    const hasOptions = (chatbot.audience_options ?? []).length > 0
    let cancelled = false
    fetch(`/api/chatbots/${chatbot.id}/preferences`)
      .then((res) => (res.ok ? res.json() : null))
      .then((prefs) => {
        if (cancelled || !prefs) return
        if (hasOptions) {
          setEntity(prefs.entity_type ?? null)
          setEntityDismissed(Boolean(prefs.entity_prompt_dismissed))
        }
        setEmailAlerts(Boolean(prefs.email_alerts))
        setVoiceLength(parseVoiceLength(prefs.length))
        setVoiceNavigation(parseVoiceNavigation(prefs.navigation))
      })
      .catch((error) => console.error("Error loading preferences:", error))
    return () => {
      cancelled = true
    }
  }, [chatbot])

  const savePreferences = useCallback(
    async (patch: {
      entity_type?: string | null
      entity_prompt_dismissed?: boolean
      email_alerts?: boolean
      length?: VoiceLength
      navigation?: VoiceNavigation
    }) => {
      if (!chatbot) return false
      try {
        const res = await fetch(`/api/chatbots/${chatbot.id}/preferences`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(patch),
        })
        if (!res.ok) return false
        const prefs = await res.json()
        setEntity(prefs.entity_type ?? null)
        setEntityDismissed(Boolean(prefs.entity_prompt_dismissed))
        setEmailAlerts(Boolean(prefs.email_alerts))
        setVoiceLength(parseVoiceLength(prefs.length))
        setVoiceNavigation(parseVoiceNavigation(prefs.navigation))
        return true
      } catch (error) {
        console.error("Error saving preferences:", error)
        return false
      }
    },
    [chatbot]
  )

  // One conversation id per assistant, so switching assistants never mixes histories.
  const sessionKey = sessionStorageKey(chatbot?.id)

  const getSessionId = useCallback(() => {
    let sessionId = localStorage.getItem(sessionKey)
    if (!sessionId) {
      sessionId = crypto.randomUUID()
      localStorage.setItem(sessionKey, sessionId)
    }
    return sessionId
  }, [sessionKey])

  /** Loads a stored conversation into the chat. */
  const loadSession = useCallback(
    async (sessionId: string): Promise<boolean> => {
      if (!chatbot) return false
      const epoch = ++conversationEpoch.current
      try {
        const response = await fetch("/api/history", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatbotId: chatbot.id, sessionId }),
        })
        if (!response.ok) return false
        const rows = (await response.json()) as TranscriptRow[]
        if (epoch !== conversationEpoch.current) return false
        const loaded: ChatMessage[] = rows.map((row, index) => ({
          id: row.id,
          role: row.role,
          content: row.content,
          pinned: row.pinned,
          folder: row.folder,
          citations: row.citations ?? [],
          followUps:
            index === rows.length - 1 && row.role === "assistant"
              ? row.meta?.follow_ups
              : undefined,
          clarify: row.meta?.clarify,
          entityFilter: row.meta?.entity_filter,
          research: row.meta?.research,
          webSources: row.meta?.web_sources,
          passage: readPassage(row.meta?.passage) ?? undefined,
        }))
        localStorage.setItem(sessionKey, sessionId)
        setMessages(loaded)
        setSelectedCitation(null)

        const lastAnswer = [...loaded].reverse().find((m) => m.role === "assistant")
        setResults(
          lastAnswer
            ? toResults(citedCitations(lastAnswer.content, lastAnswer.citations ?? []))
            : []
        )
        setPassageFocus(null)
        setCurrentView("chat")
        return true
      } catch (error) {
        console.error("Error loading session history:", error)
        return false
      }
    },
    [chatbot, sessionKey]
  )

  // Reloading the page keeps the conversation in progress.
  useEffect(() => {
    const sessionId = chatbot ? localStorage.getItem(sessionKey) : null
    if (sessionId) void loadSession(sessionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatbot?.id])

  const { toast } = useToast()

  const stampUserMessage = (list: ChatMessage[], userMessageId?: string) => {
    if (!userMessageId) return list
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].role !== "user") continue
      if (list[i].id) return list
      const copy = list.slice()
      copy[i] = { ...copy[i], id: userMessageId }
      return copy
    }
    return list
  }

  const handleSend = async (
    messageOverride?: string,
    baseMessages: ChatMessage[] = messages,
    options: {
      useEntityFilter?: boolean
      focus?: { action: DocumentAction; fileIds: string[] }
      research?: boolean
      passage?: PassageContext | null
    } = {}
  ) => {
    if (!chatbot || isSearching) return
    const text = (messageOverride ?? input).trim()
    if (!text) return
    const passage = options.passage === undefined ? passageFocus : options.passage

    conversationEpoch.current++
    const sessionId = getSessionId()
    const userMessage: ChatMessage = {
      role: "user",
      content: text,
      ...(passage ? { passage } : {}),
    }
    setPassageFocus(null)
    // Suggestions belong to the previous answer only.
    const withoutFollowUps = baseMessages.map((m) =>
      m.followUps ? { ...m, followUps: undefined } : m
    )
    const updatedMessages = [...withoutFollowUps, userMessage]
    setMessages(updatedMessages)
    setInput("")
    setSearchPhase("thinking")
    setIsSearching(true)
    setResearchProgress(options.research ? [] : null)
    if (options.research) setResearchMode(false)
    let progress: ResearchStep[] = []

    const controller = new AbortController()
    abortRef.current = controller

    const showAnswer = (data: StreamDone, replaceLast: boolean) => {
      const cited = citedCitations(data.output_text, data.citations)
      const assistantMessage: ChatMessage = {
        id: data.id,
        role: "assistant",
        content: data.output_text,
        citations: cited,
        clarify: data.clarify ?? undefined,
        entityFilter: data.entity_filter ?? undefined,
        research: data.research ?? undefined,
        webSources: data.web_sources ?? undefined,
      }
      setMessages((prev) => {
        const base = stampUserMessage(
          replaceLast ? prev.slice(0, -1) : prev,
          data.user_message_id
        )
        return [...base, assistantMessage]
      })
      setResults(toResults(cited))
      setSelectedCitation(null)
    }

    let started = false
    let streamedText = ""
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          query: [userMessage],
          chatbotId: chatbot.id,
          sessionId,
          stream: true,
          ...(options.useEntityFilter === false ? { useEntityFilter: false } : {}),
          ...(options.focus ? { focus: options.focus } : {}),
          ...(options.research ? { research: true } : {}),
          ...(passage
            ? {
                passage: {
                  title: passage.title,
                  text: passage.text.slice(0, 4000),
                  location: passage.location,
                },
              }
            : {}),
        }),
        signal: controller.signal,
      })

      const contentType = response.headers.get("content-type") ?? ""
      if (!response.ok || !contentType.includes("application/x-ndjson")) {
        // Errors (and the "no documents yet" reply) come back as plain JSON.
        const data = await response.json().catch(() => ({}))
        if (!response.ok || !data.output_text) {
          throw new Error(data.error || "No response from server")
        }
        showAnswer(
          {
            id: data.id,
            output_text: data.output_text,
            citations: data.citations ?? [],
            user_message_id: data.user_message_id,
            web_sources: data.web_sources,
          },
          false
        )
        return
      }

      let finished = false
      await readEvents(response, (event: StreamEvent) => {
        if (event.type === "status") {
          if (!options.research) setSearchPhase("searching")
        } else if (event.type === "plan") {
          progress = event.steps.map((step) => ({
            id: step.id,
            label: step.label,
            sources: 0,
            status: "searching" as const,
          }))
          setResearchProgress(progress)
        } else if (event.type === "step") {
          progress = progress.map((step) =>
            step.id === event.id
              ? { ...step, status: event.status, sources: event.sources ?? step.sources }
              : step
          )
          setResearchProgress(progress)
        } else if (event.type === "delta") {
          streamedText += event.text
          const content = formatReferences(streamedText)
          if (!started) {
            started = true
            setIsSearching(false)
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content,
                ...(options.research ? { research: { steps: progress } } : {}),
              },
            ])
          } else {
            setMessages((prev) => [
              ...prev.slice(0, -1),
              {
                role: "assistant",
                content,
                ...(options.research ? { research: { steps: progress } } : {}),
              },
            ])
          }
        } else if (event.type === "done") {
          finished = true
          setIsSearching(false)
          showAnswer(event, started)
        } else if (event.type === "followups") {
          setMessages((prev) => {
            const last = prev[prev.length - 1]
            if (!last || last.role !== "assistant") return prev
            return [...prev.slice(0, -1), { ...last, followUps: event.questions }]
          })
        } else if (event.type === "error") {
          throw new Error(event.message)
        }
      })
      if (!finished) throw new Error("The answer was interrupted")
    } catch (error) {
      const stopped = (error as Error)?.name === "AbortError"
      if (!stopped) console.error("Error sending message:", error)

      const note = stopped
        ? "_Respuesta detenida._"
        : "Lo siento, hubo un error al procesar tu solicitud. Por favor, inténtalo de nuevo."
      // A half-streamed answer is kept when the user stopped it, and replaced
      // by the error otherwise.
      const partial = started ? formatReferences(streamedText) : ""
      const content = stopped && partial ? `${partial}\n\n${note}` : note
      setMessages((prev) => {
        const base = started ? prev.slice(0, -1) : prev
        return [...base, { role: "assistant", content, error: true }]
      })
    } finally {
      abortRef.current = null
      setIsSearching(false)
      setResearchProgress(null)
    }
  }

  const handleStop = () => abortRef.current?.abort()

  const handleEditQuestion = async (messageId: string, text: string) => {
    if (!chatbot || isSearching) return
    const index = messages.findIndex(
      (message) => message.id === messageId && message.role === "user"
    )
    if (index < 0) return
    const sessionId = getSessionId()
    const response = await fetch("/api/history/rewind", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatbotId: chatbot.id, sessionId, messageId }),
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) {
      toast({
        description: payload.error || "No se pudo editar la pregunta.",
        variant: "destructive",
      })
      return
    }
    await handleSend(text, messages.slice(0, index), {
      passage: messages[index].passage ?? null,
    })
  }

  const handlePlaceMessage = async (
    messageId: string,
    patch: { pinned?: boolean; setFolder?: boolean; folder?: string | null }
  ) => {
    if (!chatbot) return
    const response = await fetch("/api/messages/place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatbotId: chatbot.id, messageId, ...patch }),
    })
    if (!response.ok) {
      toast({ description: "No se pudo organizar el mensaje.", variant: "destructive" })
      return
    }
    setMessages((prev) =>
      prev.map((message) => {
        if (message.id !== messageId) return message
        return {
          ...message,
          ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
          ...(patch.setFolder ? { folder: patch.folder ?? null } : {}),
        }
      })
    )
  }

  const [pendingAction, setPendingAction] = useState<{
    action: Exclude<DocumentAction, "summarize">
    source: { id: string; title: string }
  } | null>(null)

  /** Starts an action on a cited document; two-document actions ask for the other one first. */
  const handleDocumentAction = (action: DocumentAction, source: SourceItem) => {
    if (!source.fileId || isSearching) return
    const doc = { id: source.fileId, title: source.title }
    if (action === "summarize") {
      void handleSend(actionQuestion(action, [doc.title]), messages, {
        focus: { action, fileIds: [doc.id] },
      })
      return
    }
    setPendingAction({ action, source: doc })
  }

  /** "Ver qué cambió" from a change alert: the new document against the one it replaced. */
  const handleAlertCompare = (alert: ChangeAlert) => {
    if (isSearching) return
    void handleSend(
      actionQuestion("changes", [alert.newFile.name, alert.oldFile.name]),
      messages,
      { focus: { action: "changes", fileIds: [alert.newFile.id, alert.oldFile.id] } }
    )
  }

  const handlePickOther = (other: { id: string; title: string }) => {
    if (!pendingAction) return
    const { action, source } = pendingAction
    setPendingAction(null)
    void handleSend(actionQuestion(action, [source.title, other.title]), messages, {
      focus: { action, fileIds: [source.id, other.id] },
    })
  }

  /** Answers a clarifying question; an entity-type question also saves the choice. */
  const handleClarifyPick = async (option: string, kind?: "entity_type") => {
    if (kind === "entity_type") {
      await savePreferences({ entity_type: option })
      void handleSend(`Mi perfil es: ${option}`)
      return
    }
    void handleSend(option)
  }

  /** Asks the last question again over every document, ignoring the entity filter. */
  const handleSearchAll = () => {
    const lastUser = [...messages].map((m) => m.role).lastIndexOf("user")
    if (lastUser === -1) return
    // A reply to a clarifying question only makes sense next to that question.
    const clarified =
      messages[lastUser - 1]?.clarify && messages[lastUser - 2]?.role === "user"
    const question = clarified
      ? `${messages[lastUser - 2].content} (${messages[lastUser].content})`
      : messages[lastUser].content
    void handleSend(question, messages.slice(0, lastUser), {
      useEntityFilter: false,
      passage: messages[lastUser].passage ?? null,
    })
  }

  /** Asks the last question again, dropping the failed or stopped answer. */
  const handleRetry = () => {
    const lastUser = [...messages].map((m) => m.role).lastIndexOf("user")
    if (lastUser === -1) return
    handleSend(messages[lastUser].content, messages.slice(0, lastUser), {
      passage: messages[lastUser].passage ?? null,
    })
  }

  const handleNewConversation = () => {
    conversationEpoch.current++
    abortRef.current?.abort()
    localStorage.setItem(sessionKey, crypto.randomUUID())
    setMessages([])
    setResults([])
    setInput("")
    setSelectedCitation(null)
    setPassageFocus(null)
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push("/login")
  }

  const handleAskAbout = (result: Result) => {
    const text = result.extract.trim().slice(0, 4000)
    if (!text || isSearching) return
    setPassageFocus({
      title: result.title,
      text,
      location: result.location,
    })
    setIsDrawerOpen(true)
  }

  const handleCitationClick = (citationNumber: number | null) => {
    setSelectedCitation(citationNumber === selectedCitation ? null : citationNumber)
    if (citationNumber) {
      setIsDrawerOpen(true)
      requestAnimationFrame(() =>
        document
          .getElementById(`source-${citationNumber}`)
          ?.scrollIntoView({ behavior: "smooth", block: "nearest" })
      )
    }
  }

  const workspace = (
    <>
      {currentView === "chat" && (
        <ChatArea
          messages={messages}
          input={input}
          setInput={setInput}
          onSend={(message) =>
            handleSend(message, messages, {
              research: researchMode && researchAvailable,
            })
          }
          researchAvailable={researchAvailable}
          researchMode={researchMode}
          onResearchModeChange={setResearchMode}
          researchProgress={researchProgress}
          onStop={handleStop}
          onRetry={handleRetry}
          onNewConversation={handleNewConversation}
          getSessionId={getSessionId}
          isSearching={isSearching}
          searchPhase={searchPhase}
          messagesEndRef={messagesEndRef}
          chatbot={chatbot}
          selectedCitation={selectedCitation}
          onCitationClick={handleCitationClick}
          entity={entity}
          entityOptions={entityOptions}
          showEntityPrompt={
            entityOptions.length > 0 && !entity && !entityDismissed
          }
          onEntityChange={(value) =>
            void savePreferences({ entity_type: value })
          }
          onEntityDismiss={() =>
            void savePreferences({ entity_prompt_dismissed: true })
          }
          onClarifyPick={handleClarifyPick}
          onSearchAll={handleSearchAll}
          knowledge={knowledge}
          emptyStateExtra={
            chatbot && (
              <ChangeAlerts
                chatbotId={chatbot.id}
                onCompare={handleAlertCompare}
              />
            )
          }
          onDocumentAction={handleDocumentAction}
          onOpenMenu={isMobile ? () => setIsSidebarOpen(true) : undefined}
          onEditQuestion={handleEditQuestion}
          onPlaceMessage={handlePlaceMessage}
          passage={passageFocus}
          onClearPassage={() => setPassageFocus(null)}
        />
      )}
      {currentView === "history" && chatbot && (
        <HistoryView
          chatbotId={chatbot.id}
          isAdmin={isAdmin === true}
          currentSessionId={
            typeof window === "undefined" ? null : localStorage.getItem(sessionKey)
          }
          onOpenSession={loadSession}
          onDeletedSession={(sessionId) => {
            if (localStorage.getItem(sessionKey) === sessionId) {
              handleNewConversation()
            }
          }}
        />
      )}
      {currentView === "biblioteca" && chatbot && (
        <BibliotecaView chatbotId={chatbot.id} isAdmin={isAdmin === true} />
      )}
      {currentView === "assistant" && chatbot && isAdmin && (
        <AssistantSettings
          chatbot={chatbot}
          onSaved={(updated) =>
            setChatbot((prev) => (prev ? { ...prev, ...updated } : prev))
          }
        />
      )}
      {currentView === "assistant" && isAdmin === false && (
        <LimitedScreen title="Asistente" />
      )}
      {currentView === "profile" && (
        <ProfileView
          entity={entity}
          options={entityOptions}
          onEntityChange={(value) => void savePreferences({ entity_type: value })}
          emailAlerts={emailAlerts}
          onEmailAlertsChange={(value) => void savePreferences({ email_alerts: value })}
        />
      )}
      {currentView === "TeamPageClient" && isAdmin && (
        <TeamPageClient team={team} onNavigate={setCurrentView} />
      )}
      {currentView === "TeamPageClient" && isAdmin === false && (
        <LimitedScreen title="Miembros" />
      )}
                  {currentView === "feedback" && isAdmin && <FeedbackView />}
                  {currentView === "feedback" && isAdmin === false && (
                    <LimitedScreen title="Retroalimentación" />
                  )}
                  {currentView === "usage" && chatbot && isAdmin && (
                    <UsageView
                      chatbotId={chatbot.id}
                      onOpenHistory={() => setCurrentView("history")}
                      onOpenFeedback={() => setCurrentView("feedback")}
                    />
                  )}
                  {currentView === "usage" && isAdmin === false && (
                    <LimitedScreen title="Uso" />
                  )}
                  {currentView === "infra" && chatbot && isAdmin && (
                    <InfraestructuraView chatbotId={chatbot.id} />
                  )}
                  {currentView === "infra" && isAdmin === false && (
                    <LimitedScreen title="Infraestructura" />
                  )}
    </>
  )

  const navigation = (
    <Sidebar
      currentView={currentView}
      setCurrentView={(view) => {
        setCurrentView(view)
        if (isMobile) setIsSidebarOpen(false)
      }}
      chatbot={chatbot}
      router={router}
      isMobile={isMobile}
      onClose={() => setIsSidebarOpen(false)}
      onHide={isMobile ? undefined : hideNav}
      handleLogout={handleLogout}
      isAdmin={isAdmin}
      emailAlerts={emailAlerts}
      onEmailAlertsChange={(value) =>
        void savePreferences({ email_alerts: value })
      }
      voiceLength={voiceLength}
      onVoiceLengthChange={(value) => {
        const previous = voiceLength
        setVoiceLength(value)
        void savePreferences({ length: value }).then((ok) => {
          if (!ok) setVoiceLength(previous)
        })
      }}
      voiceNavigation={voiceNavigation}
      onVoiceNavigationChange={(value) => {
        const previous = voiceNavigation
        setVoiceNavigation(value)
        void savePreferences({ navigation: value }).then((ok) => {
          if (!ok) setVoiceNavigation(previous)
        })
      }}
    />
  )

  return (
    <VoiceSessionProvider
      chatbotId={chatbot?.id ?? null}
      isAdmin={isAdmin === true}
      onEntityChange={(value) => {
        void savePreferences({ entity_type: value })
      }}
      onNavigate={(view) => {
        setCurrentView(view)
        if (isMobile) setIsSidebarOpen(false)
      }}
    >
    <TooltipProvider>
      <div className="app-screen flex overflow-hidden text-zinc-900 dark:text-zinc-100">
        {isMobile && isSidebarOpen && (
          <button
            type="button"
            aria-label="Cerrar menú"
            className="absolute inset-0 z-40 bg-black/50"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}
        <AnimatePresence>
          {isMobile && isSidebarOpen && (
            <motion.div
              key="mobile-nav"
              initial={{ x: -300, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -300, opacity: 0 }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              className="absolute inset-y-0 left-0 z-50 h-full w-[min(100%,22rem)] max-w-full border-r border-zinc-200 bg-white dark:border-white/10 dark:bg-[#181818]"
            >
              {navigation}
            </motion.div>
          )}
        </AnimatePresence>
        {!isMobile && !isNavHidden && (
          <div className="relative h-full min-h-0 w-[248px] shrink-0 border-r border-zinc-200 bg-white dark:border-white/10 dark:bg-[#181818]">
            {navigation}
          </div>
        )}

        {!isMobile && isNavHidden && (
          <button
            type="button"
            data-testid="show-sidebar"
            aria-label="Mostrar menú"
            title="Mostrar menú"
            onClick={showNav}
            className="flex w-8 shrink-0 cursor-pointer flex-col items-center justify-center gap-2 border-r border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:border-white/10 dark:bg-[#181818] dark:text-zinc-300 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-500"
          >
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
            <span className="text-[10px] font-medium tracking-wide [writing-mode:vertical-rl]">
              Menú
            </span>
          </button>
        )}

        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-background">
          {isMobile && currentView !== "chat" && (
            <header className="flex min-h-14 shrink-0 items-center gap-1 border-b border-zinc-200 bg-white px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] dark:border-white/10 dark:bg-[#181818]">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setIsSidebarOpen(true)}
                className="h-11 w-11 text-zinc-600 dark:text-zinc-300"
                aria-label="Abrir menú"
              >
                <Menu className="h-5 w-5" />
              </Button>
              <h1 className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {workspaceTitle(currentView)}
              </h1>
            </header>
          )}

          <div className="relative min-h-0 w-full min-w-0 flex-1 overflow-hidden">
            {isMobile || currentView !== "chat" ? (
              <div className="absolute inset-0 flex min-h-0 w-full min-w-0 flex-col overflow-hidden bg-background [&>*]:min-h-0 [&>*]:flex-1">
                {workspace}
              </div>
            ) : (
            <ResizablePanelGroup
              direction="horizontal"
              className="absolute inset-0 h-full min-h-0"
              onLayout={(sizes) => {
                setPanelLayout(sizes)
                localStorage.setItem("panelLayout", JSON.stringify(sizes))
              }}
              autoSaveId="chatbot-panel-layout"
            >
              <ResizablePanel id="main-panel" className="relative min-h-0 min-w-0" defaultSize={panelLayout[0]} minSize={50}>
                <div className="absolute inset-0 flex min-h-0 w-full min-w-0 flex-col overflow-hidden [&>*]:min-h-0 [&>*]:flex-1">
                  {workspace}
                </div>
              </ResizablePanel>

              {currentView === "chat" && !isDrawerOpen && !isMobile && (
                <div
                  role="button"
                  tabIndex={0}
                  aria-label="Abrir fuentes"
                  className="flex w-8 shrink-0 cursor-pointer items-center justify-center text-zinc-600 hover:bg-zinc-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-zinc-400 dark:text-zinc-500 dark:hover:bg-zinc-800 dark:focus-visible:ring-zinc-500"
                  onClick={() => setIsDrawerOpen(true)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault()
                      setIsDrawerOpen(true)
                    }
                  }}
                >
                  <ChevronsLeft className="h-4 w-4" />
                </div>
              )}

              {currentView === "chat" && isDrawerOpen && !isMobile && (
                <>
                  <ResizableHandle withHandle />
                  <ResizablePanel
                    id="results-panel"
                    className="relative min-h-0"
                    defaultSize={panelLayout[1]}
                    minSize={20}
                    maxSize={50}
                  >
                    <div className="absolute inset-0 flex flex-col border-l border-zinc-200 bg-white dark:border-white/10 dark:bg-[#181818]">
                      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2.5 dark:border-white/10">
                        <div className="min-w-0">
                          <h2 className="text-sm font-semibold tracking-tight">Fuentes</h2>
                          <p className="text-xs text-muted-foreground">
                            {results.length === 0
                              ? "Fragmentos citados"
                              : `${results.length} ${results.length === 1 ? "fragmento" : "fragmentos"}`}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => setIsDrawerOpen(false)}
                        >
                          <ChevronsRight className="h-4 w-4" />
                        </Button>
                      </div>
                      <ResultsArea
                        results={results}
                        selectedCitation={selectedCitation}
                        onCitationClick={handleCitationClick}
                        onAskAbout={handleAskAbout}
                      />
                    </div>
                  </ResizablePanel>
                </>
              )}
            </ResizablePanelGroup>
            )}
          </div>
        </div>
      </div>
      {chatbot && (
        <DocumentActionPicker
          chatbotId={chatbot.id}
          action={pendingAction?.action ?? null}
          source={pendingAction?.source ?? null}
          onCancel={() => setPendingAction(null)}
          onPick={handlePickOther}
        />
      )}
    </TooltipProvider>
    </VoiceSessionProvider>
  )
}

function workspaceTitle(view: string) {
  switch (view) {
    case "feedback":
      return "Retroalimentación"
    case "usage":
      return "Uso"
    case "infra":
      return "Infraestructura"
    case "TeamPageClient":
      return "Miembros"
    case "biblioteca":
      return "Biblioteca"
    case "history":
      return "Historial"
    case "assistant":
      return "Asistente"
    case "chat":
      return "Chat"
    case "profile":
      return "Perfil"
    default:
      return view
  }
}

function LimitedScreen({ title }: { title: string }) {
  return (
    <div
      data-testid="limited-screen"
      className="flex h-full items-center justify-center bg-[#1e1e1e] p-6 text-sm text-zinc-300"
    >
      {title} es solo para administradores del equipo.
    </div>
  )
}

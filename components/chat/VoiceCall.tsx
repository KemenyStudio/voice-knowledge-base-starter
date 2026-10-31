"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { createPortal } from "react-dom"
import { Loader2, Phone, PhoneOff } from "lucide-react"

import { DocumentPreviewDialog } from "@/components/chat/DocumentPreview"
import { Button } from "@/components/ui/button"
import { matchVoiceCommand, type VoiceCommand } from "@/lib/voice/commands"
import { classifyVoiceEvent, consultaFromToolArgs, toolStringArg } from "@/lib/voice/events"
import {
  APP_TOOL_NAME,
  HANGUP_TOOL_NAME,
  LIBRARY_SUMMARY_TOOL_NAME,
  LIBRARY_TOOL_NAME,
  LIST_TOOL_NAME,
  NAVIGATE_TOOL_NAME,
  OPEN_TOOL_NAME,
  REMEMBER_TOOL_NAME,
  VOICE_TOOL_NAMES,
  isAsyncVoiceTool,
  spokenCapabilities,
  type VoiceToolName,
} from "@/lib/voice/instructions"
import {
  gateAsyncFinished,
  gateAsyncStarted,
  gateRequestResponse,
  gateResponseBusy,
  gateResponseFinished,
  gateResponseStarted,
  gateToolFinished,
  gateToolStarted,
  idleResponseGate,
  type GateStep,
} from "@/lib/voice/response-gate"
import { screenById, viewForAppDatum } from "@/lib/voice/screens"
import {
  EMPTY_TRANSCRIPT,
  reduceTranscript,
  type TranscriptState,
} from "@/lib/voice/transcript"
import { cn } from "@/lib/utils"

type Phase = "idle" | "connecting" | "live"

interface VoiceSessionProps {
  chatbotId: string | null
  onEntityChange?: (entity: string | null) => void
  /** Changes the open page. The call stays up. */
  onNavigate?: (view: string) => void
  isAdmin?: boolean
  children: ReactNode
}

interface VoiceCallProps {
  /** Notified when the call is idle, connecting, or live. */
  onPhaseChange?: (phase: Phase) => void
  buttonClassName?: string
}

interface VoiceSessionValue {
  ready: boolean
  phase: Phase
  error: string | null
  start: () => void
  hangup: () => void
}

const VoiceSessionContext = createContext<VoiceSessionValue | null>(null)

function useVoiceSession(): VoiceSessionValue {
  const value = useContext(VoiceSessionContext)
  if (!value) {
    throw new Error("La llamada tiene que vivir dentro de VoiceSessionProvider.")
  }
  return value
}

interface ActionResult {
  output?: string
  error?: string
  entity?: string | null
  document?: { title: string; url: string }
  navigate?: string
}

const GREETING = {
  instructions:
    "Saluda en una frase en español e invita a preguntar sobre los documentos de la biblioteca. No busques todavía.",
}

function voiceTool(name: string): VoiceToolName | null {
  return VOICE_TOOL_NAMES.includes(name as VoiceToolName) ? (name as VoiceToolName) : null
}

/** Owns the Realtime session for the whole assistant page. Drawer and view changes do not remount it. */
export function VoiceSessionProvider({
  chatbotId,
  onEntityChange,
  onNavigate,
  isAdmin = false,
  children,
}: VoiceSessionProps) {
  const [phase, setPhase] = useState<Phase>("idle")
  const [status, setStatus] = useState("Conectando…")
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<TranscriptState>(EMPTY_TRANSCRIPT)
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null)
  const [portalNode, setPortalNode] = useState<HTMLElement | null>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const dcRef = useRef<RTCDataChannel | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const transcriptRef = useRef<HTMLDivElement | null>(null)
  const chatbotIdRef = useRef(chatbotId)
  const callsRef = useRef(new Set<string>())
  const finishedResponsesRef = useRef(new Set<string>())
  const gateRef = useRef(idleResponseGate())
  const phaseRef = useRef<Phase>("idle")
  const attemptRef = useRef(0)
  const onEntityChangeRef = useRef(onEntityChange)
  const onNavigateRef = useRef(onNavigate)
  const isAdminRef = useRef(isAdmin)
  const commandRef = useRef<{ satisfied: boolean } | null>(null)
  chatbotIdRef.current = chatbotId
  onEntityChangeRef.current = onEntityChange
  onNavigateRef.current = onNavigate
  isAdminRef.current = isAdmin

  const stopMedia = useCallback(() => {
    dcRef.current?.close()
    dcRef.current = null
    pcRef.current?.close()
    pcRef.current = null
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (audioRef.current) audioRef.current.srcObject = null
  }, [])

  const hangup = useCallback(() => {
    attemptRef.current += 1
    stopMedia()
    gateRef.current = idleResponseGate()
    callsRef.current.clear()
    finishedResponsesRef.current.clear()
    phaseRef.current = "idle"
    setPhase("idle")
    setStatus("Conectando…")
  }, [stopMedia])

  // Ends the call only when the assistant page itself goes away.
  useEffect(() => () => stopMedia(), [stopMedia])

  useEffect(() => {
    setPortalNode(document.body)
  }, [])

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight })
  }, [transcript])

  const publish = useCallback((step: GateStep, response?: { instructions: string }) => {
    gateRef.current = step.gate
    const dc = dcRef.current
    if (!step.create || !dc || dc.readyState !== "open") return
    dc.send(
      JSON.stringify(
        response ? { type: "response.create", response } : { type: "response.create" }
      )
    )
  }, [])

  const deliverTool = useCallback(
    (callId: string, output: string, followUp: boolean, asyncTool: boolean) => {
      const dc = dcRef.current
      const finish = asyncTool ? gateAsyncFinished : gateToolFinished
      if (!dc || dc.readyState !== "open") {
        gateRef.current = finish(gateRef.current, followUp).gate
        return
      }
      dc.send(
        JSON.stringify({
          type: "conversation.item.create",
          item: { type: "function_call_output", call_id: callId, output },
        })
      )
      publish(finish(gateRef.current, followUp))
    },
    [publish]
  )

  const runTool = useCallback(
    async (callId: string, name: string, args: string) => {
      if (!dcRef.current || dcRef.current.readyState !== "open") return
      if (callsRef.current.has(callId)) return
      callsRef.current.add(callId)
      const tool = voiceTool(name)
      const asyncTool = tool ? isAsyncVoiceTool(tool) : false
      gateRef.current = asyncTool
        ? gateAsyncStarted(gateRef.current)
        : gateToolStarted(gateRef.current)

      const toolCoversCommand =
        tool === NAVIGATE_TOOL_NAME ||
        tool === APP_TOOL_NAME ||
        tool === LIBRARY_SUMMARY_TOOL_NAME
      if (toolCoversCommand && commandRef.current) commandRef.current.satisfied = true

      if (!tool) {
        deliverTool(
          callId,
          JSON.stringify({ respuesta: "Esa herramienta no está disponible." }),
          true,
          false
        )
        return
      }

      switch (tool) {
        case HANGUP_TOOL_NAME:
          deliverTool(callId, JSON.stringify({ respuesta: "Colgando." }), false, false)
          hangup()
          return
        case NAVIGATE_TOOL_NAME: {
          const screen = screenById(toolStringArg(args, "pantalla"))
          if (!screen) {
            deliverTool(
              callId,
              JSON.stringify({ respuesta: "No reconozco esa pantalla." }),
              true,
              false
            )
            return
          }
          onNavigateRef.current?.(screen.view)
          const limited = screen.adminOnly && !isAdminRef.current
          deliverTool(
            callId,
            JSON.stringify({
              respuesta: limited
                ? `Abrí ${screen.label}. Los datos de esa pantalla son para administradores.`
                : `Abrí ${screen.label}.`,
            }),
            true,
            false
          )
          return
        }
        case LIBRARY_TOOL_NAME: {
          const { consulta, searchAll } = consultaFromToolArgs(args)
          if (!consulta || !chatbotIdRef.current) {
            deliverTool(
              callId,
              JSON.stringify({
                respuesta: "No escuché la pregunta. Pide al usuario que la repita en español.",
                citado: false,
              }),
              true,
              true
            )
            return
          }
          setStatus("Buscando en la biblioteca…")
          try {
            const res = await fetch("/api/voice/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                chatbotId: chatbotIdRef.current,
                query: consulta,
                searchAll,
              }),
            })
            const data = (await res.json().catch(() => null)) as {
              output?: string
              error?: string
              citations?: TranscriptState["pendingCitations"]
            } | null
            if (!res.ok || !data?.output) {
              deliverTool(
                callId,
                JSON.stringify({
                  respuesta:
                    "No pude consultar la biblioteca. Di en español que lo intente de nuevo.",
                  citado: false,
                }),
                true,
                true
              )
              setError(data?.error || "No se pudo consultar la biblioteca.")
            } else {
              if (Array.isArray(data.citations)) {
                setTranscript((current) =>
                  reduceTranscript(current, { type: "citations", citations: data.citations! })
                )
              }
              deliverTool(callId, data.output, true, true)
              setError(null)
            }
          } catch {
            deliverTool(
              callId,
              JSON.stringify({
                respuesta: "No pude consultar la biblioteca. Pide repetir la pregunta.",
                citado: false,
              }),
              true,
              true
            )
            setError("No se pudo consultar la biblioteca.")
          } finally {
            if (phaseRef.current === "live") setStatus("En llamada")
          }
          return
        }
        case LIST_TOOL_NAME:
        case OPEN_TOOL_NAME:
        case REMEMBER_TOOL_NAME:
        case APP_TOOL_NAME:
        case LIBRARY_SUMMARY_TOOL_NAME: {
          const statusFor: Record<typeof tool, string> = {
            [LIST_TOOL_NAME]: "Listando la biblioteca…",
            [OPEN_TOOL_NAME]: "Abriendo el documento…",
            [REMEMBER_TOOL_NAME]: "Guardando el perfil…",
            [APP_TOOL_NAME]: "Consultando la aplicación…",
            [LIBRARY_SUMMARY_TOOL_NAME]: "Leyendo la biblioteca…",
          }
          setStatus(statusFor[tool])
          const failed = JSON.stringify({
            respuesta: "No pude completar eso. Pide al usuario que lo repita.",
          })
          try {
            const result = await postAction(tool, chatbotIdRef.current, args)
            if (!result?.output) {
              deliverTool(callId, failed, true, asyncTool)
              setError(result?.error || "No se pudo completar la acción.")
              return
            }
            if (result.navigate) onNavigateRef.current?.(result.navigate)
            if (tool === OPEN_TOOL_NAME && result.document?.url) {
              setPreview({ title: result.document.title, url: result.document.url })
            }
            if (tool === REMEMBER_TOOL_NAME && result.entity) {
              onEntityChangeRef.current?.(result.entity)
            }
            deliverTool(callId, result.output, true, asyncTool)
            setError(null)
          } catch {
            deliverTool(callId, failed, true, asyncTool)
            setError("No se pudo completar la acción.")
          } finally {
            if (phaseRef.current === "live") setStatus("En llamada")
          }
          return
        }
        default: {
          const unreachable: never = tool
          void unreachable
        }
      }
    },
    [deliverTool, hangup]
  )

  const speakExact = useCallback(
    (text: string) => {
      publish(gateRequestResponse(gateRef.current), {
        instructions: `Di exactamente esto en español, sin agregar cifras ni herramientas: ${text}`,
      })
    },
    [publish]
  )

  const runCommand = useCallback(
    async (command: VoiceCommand) => {
      if (command.type === "hangup") {
        hangup()
        return
      }
      commandRef.current = { satisfied: false }
      if (command.type === "navigate") {
        const screen = screenById(command.screen)
        if (!screen) return
        onNavigateRef.current?.(screen.view)
        if (commandRef.current.satisfied) return
        commandRef.current.satisfied = true
        const limited = screen.adminOnly && !isAdminRef.current
        speakExact(
          limited
            ? `Abrí ${screen.label}. Los datos de esa pantalla son para administradores.`
            : `Abrí ${screen.label}.`
        )
        return
      }
      if (command.type === "capabilities") {
        if (commandRef.current.satisfied) return
        commandRef.current.satisfied = true
        speakExact(spokenCapabilities())
        return
      }
      if (command.type === "library-summary") onNavigateRef.current?.("biblioteca")
      if (command.type === "app") {
        onNavigateRef.current?.(viewForAppDatum(command.dato, isAdminRef.current))
      }
      const args =
        command.type === "app" ? JSON.stringify({ dato: command.dato }) : "{}"
      const tool = command.type === "app" ? APP_TOOL_NAME : LIBRARY_SUMMARY_TOOL_NAME
      const result = await postAction(tool, chatbotIdRef.current, args)
      if (commandRef.current?.satisfied) return
      if (result?.navigate) onNavigateRef.current?.(result.navigate)
      const text = respuestaOf(result?.output)
      if (!text) return
      commandRef.current.satisfied = true
      speakExact(text)
    },
    [hangup, speakExact]
  )

  const onMessage = useCallback(
    (event: MessageEvent) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(String(event.data))
      } catch {
        return
      }
      const classified = classifyVoiceEvent(parsed)
      switch (classified.kind) {
        case "user-delta":
          setTranscript((current) =>
            reduceTranscript(current, {
              type: "delta",
              id: classified.id,
              role: "user",
              delta: classified.delta,
            })
          )
          break
        case "user-done":
          setTranscript((current) =>
            reduceTranscript(current, {
              type: "done",
              id: classified.id,
              role: "user",
              text: classified.text,
            })
          )
          const command = matchVoiceCommand(classified.text)
          if (command) void runCommand(command)
          break
        case "assistant-delta":
          setTranscript((current) =>
            reduceTranscript(current, {
              type: "delta",
              id: classified.id,
              role: "assistant",
              delta: classified.delta,
            })
          )
          break
        case "assistant-done":
          setTranscript((current) =>
            reduceTranscript(current, {
              type: "done",
              id: classified.id,
              role: "assistant",
              text: classified.text,
            })
          )
          break
        case "tool":
          void runTool(classified.callId, classified.name, classified.arguments)
          break
        case "response-started":
          gateRef.current = gateResponseStarted(gateRef.current)
          break
        case "response-finished":
          if (classified.id && finishedResponsesRef.current.has(classified.id)) break
          if (classified.id) finishedResponsesRef.current.add(classified.id)
          publish(gateResponseFinished(gateRef.current))
          break
        case "response-busy":
          gateRef.current = gateResponseBusy(gateRef.current)
          break
        case "error":
          setError(classified.message)
          break
        case "ignore":
          break
        default: {
          const unreachable: never = classified
          void unreachable
        }
      }
    },
    [publish, runCommand, runTool]
  )

  const start = useCallback(async () => {
    if (!chatbotId || phaseRef.current !== "idle") return
    const attempt = attemptRef.current + 1
    attemptRef.current = attempt
    setError(null)
    setTranscript(EMPTY_TRANSCRIPT)
    gateRef.current = idleResponseGate()
    callsRef.current.clear()
    finishedResponsesRef.current.clear()
    phaseRef.current = "connecting"
    setPhase("connecting")
    setStatus("Conectando…")

    const cancelled = () => attemptRef.current !== attempt

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      })
    } catch {
      if (cancelled()) return
      phaseRef.current = "idle"
      setPhase("idle")
      setError("No se pudo usar el micrófono. Permite el acceso e inténtalo de nuevo.")
      return
    }
    if (cancelled()) {
      stream.getTracks().forEach((track) => track.stop())
      return
    }
    streamRef.current = stream

    try {
      const tokenRes = await fetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotId }),
      })
      const tokenJson = (await tokenRes.json().catch(() => null)) as {
        clientSecret?: string
        error?: string
      } | null
      const clientSecret = tokenJson?.clientSecret
      if (cancelled()) return
      if (!tokenRes.ok || !clientSecret) {
        throw new Error(tokenJson?.error || "No se pudo iniciar la llamada.")
      }

      const pc = new RTCPeerConnection()
      pcRef.current = pc
      pc.ontrack = (media) => {
        const audio = audioRef.current
        if (!audio) return
        audio.srcObject = media.streams[0]
        void audio.play().catch(() => undefined)
      }
      for (const track of stream.getTracks()) pc.addTrack(track, stream)

      const dc = pc.createDataChannel("oai-events")
      dcRef.current = dc
      dc.addEventListener("message", onMessage)
      dc.addEventListener("open", () => {
        if (cancelled()) return
        phaseRef.current = "live"
        setPhase("live")
        setStatus("En llamada")
        publish(gateRequestResponse(gateRef.current), GREETING)
      })

      const offer = await pc.createOffer()
      await pc.setLocalDescription(offer)
      const sdpResponse = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        body: offer.sdp ?? "",
        headers: {
          Authorization: `Bearer ${clientSecret}`,
          "Content-Type": "application/sdp",
        },
      })
      const answerSdp = await sdpResponse.text()
      if (cancelled()) return
      if (!sdpResponse.ok || !answerSdp.trim()) {
        throw new Error("No se pudo conectar la llamada.")
      }
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp })
    } catch (startError) {
      if (cancelled()) return
      stopMedia()
      phaseRef.current = "idle"
      setPhase("idle")
      setError(
        startError instanceof Error
          ? startError.message
          : "No se pudo iniciar la llamada."
      )
    }
  }, [chatbotId, onMessage, publish, stopMedia])

  const session = useMemo<VoiceSessionValue>(
    () => ({
      ready: Boolean(chatbotId),
      phase,
      error,
      start: () => {
        void start()
      },
      hangup,
    }),
    [chatbotId, phase, error, start, hangup]
  )

  const inCall = phase !== "idle"
  const dock = (
    <>
      <audio ref={audioRef} autoPlay className="hidden" data-testid="voice-call-audio" />
      {inCall && (
        <div
          data-testid="voice-call-dock"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] flex max-h-[min(70dvh,32rem)] flex-col rounded-lg border bg-white shadow-lg dark:bg-gray-900 sm:inset-x-auto sm:right-4 sm:w-96"
        >
          <div className="flex items-center justify-between border-b px-3 py-2">
            <p className="text-sm font-medium">{status}</p>
            <Button type="button" size="sm" variant="destructive" onClick={hangup}>
              Colgar
            </Button>
          </div>
          <div ref={transcriptRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite">
            {transcript.lines.length === 0 && (
              <p className="text-sm text-gray-500">
                La transcripción en español aparece aquí. Las respuestas salen de la biblioteca.
              </p>
            )}
            {transcript.lines.map((line) => (
              <div key={line.id}>
                <p className="text-xs font-medium text-gray-500">
                  {line.role === "user" ? "Tú" : "Asistente"}
                </p>
                <p className="whitespace-pre-wrap text-sm">{line.text}</p>
                {line.citations && line.citations.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-xs text-gray-500">
                    {line.citations.map((citation) => (
                      <li key={`${line.id}-${citation.number}`}>
                        [{citation.number}] {citation.title}
                        {citation.outdated ? " · Desactualizado" : ""}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
            {error && <p className="text-sm text-red-600">{error}</p>}
          </div>
        </div>
      )}
      {!inCall && error && (
        <p
          role="alert"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-[60] rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-red-700 shadow-lg dark:bg-gray-900 sm:inset-x-auto sm:right-4 sm:max-w-sm"
        >
          {error}
        </p>
      )}
      <DocumentPreviewDialog
        title={preview?.title ?? ""}
        url={preview?.url ?? null}
        onClose={() => setPreview(null)}
      />
    </>
  )

  return (
    <VoiceSessionContext.Provider value={session}>
      {children}
      {portalNode ? createPortal(dock, portalNode) : dock}
    </VoiceSessionContext.Provider>
  )
}

/** Llamar / Colgar in the sidebar. Unmounting this button does not end the call. */
export function VoiceCall({ onPhaseChange, buttonClassName }: VoiceCallProps) {
  const { ready, phase, error, start, hangup } = useVoiceSession()

  useEffect(() => {
    onPhaseChange?.(phase)
  }, [phase, onPhaseChange])

  if (!ready) return null

  return (
    <Button
      type="button"
      variant={phase === "live" ? "destructive" : "ghost"}
      size="sm"
      onClick={() => (phase === "live" ? hangup() : start())}
      disabled={phase === "connecting"}
      className={cn(
        phase === "idle" &&
          "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-200 dark:hover:bg-white/10 dark:hover:text-white",
        buttonClassName
      )}
      aria-label={phase === "live" ? "Colgar" : "Llamar"}
      title={error ?? "Hablar en español con la biblioteca de este asistente"}
    >
      {phase === "connecting" ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : phase === "live" ? (
        <PhoneOff className="mr-2 h-4 w-4" />
      ) : (
        <Phone className="mr-2 h-4 w-4" />
      )}
      {phase === "live" ? "Colgar" : phase === "connecting" ? "Conectando" : "Llamar"}
    </Button>
  )
}

function respuestaOf(output?: string): string {
  if (!output) return ""
  try {
    const parsed = JSON.parse(output) as { respuesta?: unknown }
    return typeof parsed.respuesta === "string" ? parsed.respuesta : ""
  } catch {
    return ""
  }
}

type ActionTool =
  | typeof LIST_TOOL_NAME
  | typeof OPEN_TOOL_NAME
  | typeof REMEMBER_TOOL_NAME
  | typeof APP_TOOL_NAME
  | typeof LIBRARY_SUMMARY_TOOL_NAME

async function postAction(
  tool: ActionTool,
  chatbotId: string | null,
  args: string
): Promise<ActionResult | null> {
  if (!chatbotId) return null
  const body = actionBody(tool, chatbotId, args)
  if (!body) return { error: "Faltan datos para esa acción." }
  const res = await fetch("/api/voice/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  const data = (await res.json().catch(() => null)) as ActionResult | null
  if (!res.ok) return { error: data?.error || "No se pudo completar la acción." }
  return data
}

function actionBody(
  tool: ActionTool,
  chatbotId: string,
  args: string
): Record<string, string> | null {
  switch (tool) {
    case LIST_TOOL_NAME:
      return { action: "list", chatbotId }
    case OPEN_TOOL_NAME: {
      const titulo = toolStringArg(args, "titulo")
      return titulo ? { action: "open", chatbotId, titulo } : null
    }
    case REMEMBER_TOOL_NAME: {
      const perfil = toolStringArg(args, "perfil")
      return perfil ? { action: "remember", chatbotId, perfil } : null
    }
    case APP_TOOL_NAME: {
      const dato = toolStringArg(args, "dato")
      if (
        dato !== "miembros" &&
        dato !== "preguntas" &&
        dato !== "retroalimentacion" &&
        dato !== "salud"
      ) {
        return null
      }
      return { action: "app", chatbotId, dato }
    }
    case LIBRARY_SUMMARY_TOOL_NAME:
      return { action: "biblioteca", chatbotId }
    default: {
      const unreachable: never = tool
      return unreachable
    }
  }
}

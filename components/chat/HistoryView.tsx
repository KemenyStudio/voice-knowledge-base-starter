"use client"

import { memo, useEffect, useMemo, useState } from "react"
import { Download, History, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react"
import { motion } from "framer-motion"

import { sessionHeading } from "@/lib/chat/session-title"
import { downloadTextFile, safeFilename } from "@/lib/chat/export"
import { transcriptToMarkdown, type TranscriptTurn } from "@/lib/chat/references"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useToast } from "@/hooks/use-toast"

interface Session {
  message: string
  session: string
  createdAt: string | number
  title: string
}

interface RecentQuestion {
  id: string
  text: string
  createdAt: string
  email: string | null
  sessionId: string
  own: boolean
}

interface HistoryViewProps {
  chatbotId: string
  isAdmin?: boolean
  currentSessionId: string | null
  onOpenSession: (sessionId: string) => Promise<boolean>
  /** Called after a conversation is deleted, so an open chat of that id can reset. */
  onDeletedSession?: (sessionId: string) => void
}

export const HistoryView = memo(function HistoryView({
  chatbotId,
  isAdmin = false,
  currentSessionId,
  onOpenSession,
  onDeletedSession,
}: HistoryViewProps) {
  const { toast } = useToast()
  const [sessions, setSessions] = useState<Session[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [remote, setRemote] = useState<Session[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [rename, setRename] = useState<{ session: string; title: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Session | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<RecentQuestion[] | null>(null)
  const [questionsError, setQuestionsError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setIsLoading(true)
      setLoadError(false)
      try {
        const response = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatbotId }),
        })
        if (!response.ok) throw new Error("Failed to fetch sessions")
        const data = await response.json()
        if (!cancelled) setSessions(Array.isArray(data) ? data : [])
      } catch (error) {
        console.error("Error fetching sessions:", error)
        if (!cancelled) setLoadError(true)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [chatbotId])

  useEffect(() => {
    if (!isAdmin) {
      setQuestions(null)
      setQuestionsError(null)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch(`/api/history/questions?chatbotId=${chatbotId}`)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || "No se pudieron cargar las preguntas.")
        if (!cancelled) {
          setQuestions(Array.isArray(payload.questions) ? payload.questions : [])
          setQuestionsError(null)
        }
      } catch (loadError) {
        if (!cancelled) setQuestionsError((loadError as Error).message)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [chatbotId, isAdmin])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setRemote(null)
      setSearching(false)
      return
    }
    let cancelled = false
    setRemote(null)
    setSearching(true)
    const handle = setTimeout(async () => {
      try {
        const response = await fetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatbotId, query: q }),
        })
        const data = await response.json().catch(() => [])
        if (!response.ok) throw new Error("search failed")
        if (!cancelled) setRemote(Array.isArray(data) ? data : [])
      } catch (error) {
        console.error("Error searching sessions:", error)
        if (!cancelled) {
          setRemote(null)
          toast({
            description: "No se pudo buscar en el historial.",
            variant: "destructive",
          })
        }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [chatbotId, query, toast])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (q.length >= 2 && remote) return remote
    if (!q) return sessions
    return sessions.filter((session) => {
      const heading = sessionHeading(session.title, session.message).toLowerCase()
      return (
        heading.includes(q) || session.message.toLowerCase().includes(q)
      )
    })
  }, [query, remote, sessions])

  const open = async (sessionId: string) => {
    setOpeningId(sessionId)
    await onOpenSession(sessionId)
    setOpeningId(null)
  }

  const replaceSession = (sessionId: string, title: string) => {
    const apply = (list: Session[]) =>
      list.map((session) =>
        session.session === sessionId ? { ...session, title } : session
      )
    setSessions(apply)
    setRemote((current) => (current ? apply(current) : current))
  }

  const removeSession = (sessionId: string) => {
    const apply = (list: Session[]) =>
      list.filter((session) => session.session !== sessionId)
    setSessions(apply)
    setRemote((current) => (current ? apply(current) : current))
  }

  const saveRename = async () => {
    if (!rename) return
    const title = rename.title.trim()
    if (!title || title.length > 120) {
      toast({
        description: "El título debe tener entre 1 y 120 caracteres.",
        variant: "destructive",
      })
      return
    }
    setBusyId(rename.session)
    try {
      const response = await fetch("/api/sessions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatbotId,
          sessionId: rename.session,
          title,
        }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(data.error || "rename failed")
      }
      replaceSession(rename.session, data.title || title)
      setRename(null)
      toast({ description: "Nombre actualizado.", duration: 2000 })
    } catch (error) {
      console.error("rename", error)
      toast({
        description:
          error instanceof Error && error.message !== "rename failed"
            ? error.message
            : "No se pudo cambiar el nombre.",
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const confirmDelete = async (session: Session) => {
    const sessionId = session.session
    setBusyId(sessionId)
    try {
      const response = await fetch("/api/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotId, sessionId }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "delete failed")
      removeSession(sessionId)
      onDeletedSession?.(sessionId)
      setPendingDelete(null)
      toast({ description: "Conversación eliminada.", duration: 2000 })
    } catch (error) {
      console.error("delete", error)
      toast({
        description: "No se pudo eliminar la conversación.",
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const download = async (session: Session) => {
    setBusyId(session.session)
    try {
      const response = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotId, sessionId: session.session }),
      })
      const data = await response.json().catch(() => [])
      if (!response.ok || !Array.isArray(data)) {
        throw new Error("download failed")
      }
      const heading = sessionHeading(session.title, session.message)
      const markdown = transcriptToMarkdown(heading, data as TranscriptTurn[])
      downloadTextFile(safeFilename(heading, "md"), markdown)
    } catch (error) {
      console.error("download", error)
      toast({
        description: "No se pudo descargar la conversación.",
        variant: "destructive",
      })
    } finally {
      setBusyId(null)
    }
  }

  const searchingRemote = query.trim().length >= 2 && searching

  return (
    <motion.div
      className="flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg dark:bg-black sm:p-4"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
            <History className="h-6 w-6 text-blue-500" />
            Historial de consultas
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {isAdmin
              ? "Las preguntas recientes del equipo están aquí. Abre una conversación tuya para seguir."
              : "Abre una conversación para releerla o seguir preguntando. Busca por una pregunta o una respuesta; la lista muestra las más recientes."}
          </p>
          <Input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar en tus conversaciones"
            aria-label="Buscar en tus conversaciones"
            className="mt-2"
          />
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="space-y-3 pr-3">
              {isAdmin && (
                <section className="mb-2 rounded-lg border p-3">
                  <h2 className="text-sm font-semibold">Preguntas recientes</h2>
                  <p className="mb-2 text-xs text-muted-foreground">
                    Las tuyas se abren. Las de otras personas se leen aquí.
                  </p>
                  {questions === null && !questionsError && (
                    <p className="text-sm text-muted-foreground">Cargando…</p>
                  )}
                  {questionsError && (
                    <p className="text-sm text-destructive">{questionsError}</p>
                  )}
                  {questions && questions.length === 0 && (
                    <p className="text-sm text-muted-foreground">Todavía no hay preguntas.</p>
                  )}
                  {questions && questions.length > 0 && (
                    <ul className="space-y-3">
                      {questions.map((item) => {
                        const body = (
                          <>
                            <p>{item.text}</p>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {item.email ?? "Miembro"} · {formatIso(item.createdAt)}
                            </p>
                          </>
                        )
                        return (
                          <li key={item.id} className="border-b pb-3 text-sm last:border-b-0 last:pb-0">
                            {item.own ? (
                              <button
                                type="button"
                                onClick={() => open(item.sessionId)}
                                className="w-full text-left hover:opacity-80"
                              >
                                {body}
                              </button>
                            ) : (
                              body
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </section>
              )}
              {isLoading && <p>Cargando conversaciones...</p>}
              {loadError && (
                <p className="text-sm text-muted-foreground">
                  No se pudo cargar el historial.
                </p>
              )}
              {searchingRemote && (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Buscando en conversaciones anteriores...
                </p>
              )}
              {!isLoading && !loadError && shown.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  {query.trim()
                    ? "Ninguna conversación coincide con esa búsqueda."
                    : "Todavía no tienes conversaciones con este asistente."}
                </p>
              )}
              {shown.map((session) => {
                const heading = sessionHeading(session.title, session.message)
                return (
                  <div
                    key={session.session}
                    className="flex items-start gap-2 rounded-lg border p-4"
                  >
                    <button
                      type="button"
                      onClick={() => open(session.session)}
                      className="min-w-0 flex-1 text-left hover:opacity-80"
                    >
                      <div className="mb-2 flex flex-col items-start gap-2 sm:flex-row sm:justify-between">
                        <h3 className="break-words font-medium">{heading}</h3>
                        <div className="flex flex-shrink-0 items-center gap-2">
                          {openingId === session.session && (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          )}
                          {session.session === currentSessionId && (
                            <Badge>Actual</Badge>
                          )}
                          <Badge variant="outline">
                            {formatWhen(session.createdAt)}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        {session.message.length > 300
                          ? `${session.message.slice(0, 300)}...`
                          : session.message}
                      </p>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="shrink-0"
                          aria-label={`Acciones de ${heading}`}
                          disabled={busyId === session.session}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          onSelect={() => {
                            const next = { session: session.session, title: heading }
                            setTimeout(() => setRename(next), 0)
                          }}
                        >
                          <Pencil className="mr-2 h-4 w-4" />
                          Renombrar
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => download(session)}>
                          <Download className="mr-2 h-4 w-4" />
                          Descargar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-red-600 focus:text-red-600"
                          onSelect={() => {
                            const next = session
                            setTimeout(() => setPendingDelete(next), 0)
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Eliminar
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={rename !== null} onOpenChange={(open) => !open && setRename(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Renombrar conversación</DialogTitle>
            <DialogDescription>
              El nombre se usa para encontrarla después. No cambia las preguntas ni las respuestas.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={rename?.title ?? ""}
            onChange={(event) =>
              setRename((current) =>
                current ? { ...current, title: event.target.value } : current
              )
            }
            maxLength={120}
            aria-label="Nombre de la conversación"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void saveRename()
              }
            }}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRename(null)}>
              Cancelar
            </Button>
            <Button onClick={() => void saveRename()} disabled={busyId !== null}>
              Guardar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => !open && setPendingDelete(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar esta conversación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se borra de tu historial. Un enlace que ya hayas compartido sigue abierto para tu equipo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingDelete) void confirmDelete(pendingDelete)
              }}
              className="bg-red-600 text-white hover:bg-red-700"
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </motion.div>
  )
})

function formatIso(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Mexico_City",
  })
}

function formatWhen(createdAt: string | number): string {
  const seconds = Number(createdAt)
  const date = new Date(seconds * 1000)
  if (Number.isNaN(date.getTime())) return ""
  return date.toLocaleString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

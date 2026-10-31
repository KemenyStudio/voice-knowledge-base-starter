"use client"

import { memo, useMemo, useRef, useState } from "react"
import {
  ChevronDown,
  Copy,
  FileDown,
  FileText,
  Globe,
  Link2,
  Loader2,
  Printer,
  RotateCcw,
  ThumbsDown,
  ThumbsUp,
  Wand2,
} from "lucide-react"

import { AnswerMarkdown } from "@/components/chat/AnswerMarkdown"
import { ObligationsButton } from "@/components/chat/ObligationsDialog"
import { ToolDialog, type ToolTarget } from "@/components/chat/ToolDialog"
import { TOOLS, WEB_TOOL, WEB_TOOL_ID, type ToolId } from "@/lib/tools/registry"
import { ResearchSteps } from "@/components/chat/ResearchSteps"
import { Sources, buildSources, type SourceItem } from "@/components/chat/Sources"
import { WebSources } from "@/components/chat/WebSources"
import type { DocumentAction } from "@/lib/document-actions"
import type { ChatMessage } from "@/components/chat/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import {
  downloadTextFile,
  printHtml,
  safeFilename,
} from "@/lib/chat/export"
import { splitReferences, toMarkdown } from "@/lib/chat/references"

interface ResponseProps {
  message: ChatMessage
  /** The user question this answer belongs to (used when exporting). */
  question?: string
  chatbotId?: string
  getSessionId: () => string | null
  selectedCitation?: number | null
  onCitationClick?: (citationNumber: number | null) => void
  onRetry?: () => void
  onDocumentAction?: (action: DocumentAction, source: SourceItem) => void
  /** Tools the assistant offers under answers. */
  tools?: ToolId[]
}

export const Response = memo(function Response({
  message,
  question,
  chatbotId,
  getSessionId,
  selectedCitation,
  onCitationClick,
  onRetry,
  onDocumentAction,
  tools = [],
}: ResponseProps) {
  const { toast } = useToast()
  const answerRef = useRef<HTMLDivElement>(null)
  const [isSharing, setIsSharing] = useState(false)

  const [toolTarget, setToolTarget] = useState<ToolTarget | null>(null)
  const [hasRated, setHasRated] = useState(false)
  const [ratingDialogOpen, setRatingDialogOpen] = useState(false)
  const [selectedRating, setSelectedRating] = useState<1 | -1 | null>(null)
  const [ratingComment, setRatingComment] = useState("")

  const citations = useMemo(() => message.citations ?? [], [message.citations])
  const { body, references } = useMemo(
    () => splitReferences(message.content),
    [message.content]
  )
  const sources = useMemo(() => {
    const cited = new Set(
      Array.from(body.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]))
    )
    return buildSources(references, citations, cited)
  }, [body, references, citations])

  const isSaved = Boolean(message.id)
  const exportTitle = question?.slice(0, 120) || "Respuesta"

  const exportEntry = () => ({
    question,
    answer: body,
    sources: sources.map((s) => ({
      number: s.number,
      title: s.title,
      pages: s.pages,
    })),
  })

  const copy = async (withSources: boolean) => {
    const text = withSources
      ? toMarkdown(exportTitle, [exportEntry()]).replace(/^# .*\n\n/, "")
      : body
    try {
      await navigator.clipboard.writeText(text)
      toast({ description: "Copiado.", duration: 2000 })
    } catch {
      toast({ description: "No se pudo copiar.", variant: "destructive" })
    }
  }

  const downloadMarkdown = () => {
    downloadTextFile(
      safeFilename(exportTitle, "md"),
      toMarkdown(exportTitle, [exportEntry()])
    )
  }

  const savePdf = () => {
    const answerHtml = answerRef.current?.innerHTML ?? ""
    const html = `<h1>${exportTitle.replace(/</g, "&lt;")}</h1>${answerHtml}`
    if (!printHtml(exportTitle, html)) {
      toast({
        description: "Tu navegador bloqueó la ventana de impresión.",
        variant: "destructive",
      })
    }
  }

  const share = async () => {
    const sessionId = getSessionId()
    if (!chatbotId || !sessionId) return
    setIsSharing(true)
    try {
      const res = await fetch("/api/conversations/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotId, sessionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.path) throw new Error(data.error || "share failed")
      const url = `${window.location.origin}${data.path}`
      await navigator.clipboard.writeText(url).catch(() => undefined)
      toast({
        title: "Enlace copiado",
        description:
          "Los miembros de tu equipo pueden abrir esta conversación con el enlace.",
        duration: 5000,
      })
    } catch (error) {
      console.error("share", error)
      toast({
        description: "No se pudo crear el enlace.",
        variant: "destructive",
      })
    } finally {
      setIsSharing(false)
    }
  }

  const submitRating = async () => {
    if (selectedRating === null || !message.id) return
    const res = await fetch("/api/user_interaction", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating: selectedRating,
        comment: ratingComment,
        responseId: message.id,
      }),
    })
    if (res.ok) {
      setHasRated(true)
      toast({ description: "Gracias por tu calificación.", duration: 3000 })
    } else {
      toast({
        description: "Hubo un error al enviar tu calificación.",
        duration: 3000,
      })
    }
    setRatingDialogOpen(false)
  }

  const openRating = (rating: 1 | -1) => {
    if (hasRated) return
    setSelectedRating(rating)
    setRatingDialogOpen(true)
  }

  return (
    <div>
      {message.research && (
        <ResearchSteps steps={message.research.steps} finished={isSaved} writing />
      )}
      <div ref={answerRef}>
        <AnswerMarkdown
          markdown={body}
          onCitationClick={(n) =>
            onCitationClick?.(n === selectedCitation ? null : n)
          }
        />
        <Sources
          sources={sources}
          selectedCitation={selectedCitation}
          onCitationClick={onCitationClick}
          onDocumentAction={onDocumentAction}
          onCheckValidity={
            tools.includes("check_validity") && chatbotId
              ? (source) =>
                  setToolTarget({
                    tool: "check_validity",
                    fileId: source.fileId ?? undefined,
                    subject: source.title,
                  })
              : undefined
          }
          onNewerSource={
            chatbotId
              ? (source) =>
                  setToolTarget({
                    tool: WEB_TOOL_ID,
                    messageId: message.id,
                    fileId: source.fileId ?? undefined,
                    subject: source.title,
                  })
              : undefined
          }
        />
        <WebSources lookup={message.webSources} />
      </div>

      {message.error && onRetry && (
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          <RotateCcw className="mr-2 h-4 w-4" />
          Reintentar
        </Button>
      )}

      {isSaved && !message.error && (
        <div className="mt-6 flex flex-wrap items-center gap-1 border-t border-border/80 pt-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="text-gray-600">
                <Copy className="mr-1 h-4 w-4" />
                Copiar
                <ChevronDown className="ml-1 h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuItem onSelect={() => copy(false)}>
                <Copy className="mr-2 h-4 w-4" />
                Copiar respuesta
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => copy(true)}>
                <FileText className="mr-2 h-4 w-4" />
                Copiar con fuentes
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={downloadMarkdown}>
                <FileDown className="mr-2 h-4 w-4" />
                Descargar Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={savePdf}>
                <Printer className="mr-2 h-4 w-4" />
                Guardar como PDF
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          <ObligationsButton chatbotId={chatbotId} messageId={message.id} />

          {chatbotId && (
            <Button
              variant="ghost"
              size="sm"
              className="text-gray-600"
              onClick={() =>
                setToolTarget({
                  tool: WEB_TOOL_ID,
                  messageId: message.id,
                  subject: exportTitle,
                })
              }
            >
              <Globe className="mr-1 h-4 w-4" />
              {WEB_TOOL.label}
            </Button>
          )}

          {chatbotId && tools.some((t) => TOOLS[t].target === "answer") && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-gray-600"
                  data-testid="tools-menu"
                >
                  <Wand2 className="mr-1 h-4 w-4" />
                  Herramientas
                  <ChevronDown className="ml-1 h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start">
                {tools
                  .filter((t) => TOOLS[t].target === "answer")
                  .map((t) => (
                    <DropdownMenuItem
                      key={t}
                      onSelect={() =>
                        setToolTarget({ tool: t, messageId: message.id, subject: exportTitle })
                      }
                    >
                      {TOOLS[t].label}
                    </DropdownMenuItem>
                  ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="text-gray-600"
            onClick={share}
            disabled={isSharing || !chatbotId}
          >
            {isSharing ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <Link2 className="mr-1 h-4 w-4" />
            )}
            Compartir
          </Button>

          <div className="ml-auto flex items-center gap-1 text-sm text-gray-500">
            {hasRated ? (
              <span>Gracias por tu calificación.</span>
            ) : (
              <>
                <span className="mr-1 hidden sm:inline">¿Te fue útil?</span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => openRating(1)}
                  aria-label="Respuesta útil"
                >
                  <ThumbsUp className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => openRating(-1)}
                  aria-label="Respuesta no útil"
                >
                  <ThumbsDown className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {chatbotId && (
        <ToolDialog
          chatbotId={chatbotId}
          target={toolTarget}
          onClose={() => setToolTarget(null)}
        />
      )}

      <Dialog open={ratingDialogOpen} onOpenChange={setRatingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Calificar respuesta</DialogTitle>
            <DialogDescription>
              Selecciona tu calificación y deja un comentario (opcional).
            </DialogDescription>
          </DialogHeader>
          <div className="my-4 flex gap-4">
            <Button
              variant={selectedRating === 1 ? "default" : "outline"}
              onClick={() => setSelectedRating(1)}
              aria-label="Útil"
            >
              <ThumbsUp className="h-5 w-5" strokeWidth={1.5} />
            </Button>
            <Button
              variant={selectedRating === -1 ? "default" : "outline"}
              onClick={() => setSelectedRating(-1)}
              aria-label="No útil"
            >
              <ThumbsDown className="h-5 w-5" strokeWidth={1.5} />
            </Button>
          </div>
          <Textarea
            value={ratingComment}
            onChange={(e) => setRatingComment(e.target.value)}
            placeholder="Escribe un comentario (opcional)"
            className="mb-4 w-full"
          />
          <DialogFooter>
            <Button onClick={submitRating} disabled={selectedRating === null}>
              Enviar
            </Button>
            <Button
              variant="outline"
              onClick={() => setRatingDialogOpen(false)}
            >
              Cancelar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
})

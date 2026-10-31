"use client"

import { useEffect, useState } from "react"
import { Copy, FileDown, Loader2 } from "lucide-react"

import { WebSources } from "@/components/chat/WebSources"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { downloadTextFile, safeFilename } from "@/lib/chat/export"
import { INSTRUCTIONS_MAX_LENGTH, WEB_TOOL_ID, toolInfo, type RunnableToolId } from "@/lib/tools/registry"
import type { WebLookup } from "@/lib/web-search"

export interface ToolTarget {
  tool: RunnableToolId
  messageId?: string
  fileId?: string
  /** Shown in the title, e.g. the document name. */
  subject?: string
}

/** Runs an assistant tool and shows the text it produced, ready to copy or download. */
export function ToolDialog({
  chatbotId,
  target,
  onClose,
}: {
  chatbotId: string
  target: ToolTarget | null
  onClose: () => void
}) {
  const { toast } = useToast()
  const [instructions, setInstructions] = useState("")
  const [text, setText] = useState<string | null>(null)
  const [webSources, setWebSources] = useState<WebLookup | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const info = target ? toolInfo(target.tool) : null
  const needsInput = target?.tool === "draft_email" || target?.tool === "memo"
  const isWeb = target?.tool === WEB_TOOL_ID

  const run = async () => {
    if (!target) return
    setRunning(true)
    setError(null)
    setText(null)
    setWebSources(null)
    try {
      const res = await fetch("/api/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chatbotId,
          tool: target.tool,
          messageId: target.messageId,
          fileId: target.fileId,
          instructions: instructions.trim() || undefined,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo completar la herramienta")
      setText(data.text)
      setWebSources(data.web_sources ?? null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error")
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    setInstructions("")
    setText(null)
    setWebSources(null)
    setError(null)
    if (target && (target.tool === "check_validity" || target.tool === WEB_TOOL_ID)) void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.tool, target?.messageId, target?.fileId])

  const copy = async () => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      toast({ description: "Copiado.", duration: 2000 })
    } catch {
      toast({ description: "No se pudo copiar.", variant: "destructive" })
    }
  }

  return (
    <Dialog open={Boolean(target)} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-2xl" data-testid="tool-dialog">
        <DialogHeader>
          <DialogTitle>{info?.label}</DialogTitle>
          <DialogDescription>
            {target?.subject ? `${target.subject}. ` : ""}
            {isWeb
              ? "Resultados de la web, no de la biblioteca. No sustituyen las fuentes de la respuesta."
              : "Es un borrador generado con la respuesta; revísalo antes de usarlo."}
          </DialogDescription>
        </DialogHeader>

        {needsInput && text === null && (
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="tool-instructions">
              Indicaciones (opcional)
            </label>
            <Textarea
              id="tool-instructions"
              value={instructions}
              maxLength={INSTRUCTIONS_MAX_LENGTH}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={
                target?.tool === "draft_email"
                  ? "Para quién es, tono, qué destacar…"
                  : "Destinatario, enfoque, extensión…"
              }
            />
            <Button onClick={run} disabled={running}>
              {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Generar
            </Button>
          </div>
        )}

        {running && !needsInput && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {isWeb ? "Buscando en sitios oficiales…" : "Revisando el documento…"}
          </p>
        )}
        {error && (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        )}

        {text !== null && (
          <div className="space-y-2">
            <Textarea
              readOnly
              value={text}
              className="min-h-[280px] font-mono text-sm"
              data-testid="tool-output"
            />
            {isWeb && webSources && (
              <WebSources lookup={{ note: "", sources: webSources.sources }} />
            )}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={copy}>
                <Copy className="mr-1 h-4 w-4" />
                Copiar
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  downloadTextFile(
                    safeFilename(`${info?.label ?? "texto"} ${target?.subject ?? ""}`.trim(), "md"),
                    text
                  )
                }
              >
                <FileDown className="mr-1 h-4 w-4" />
                Descargar
              </Button>
              {needsInput && (
                <Button variant="ghost" size="sm" onClick={() => setText(null)}>
                  Cambiar indicaciones
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

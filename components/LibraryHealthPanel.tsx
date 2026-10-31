"use client"

import { useCallback, useEffect, useState } from "react"
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react"

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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import type { HealthIssue, HealthIssueKind, HealthReport } from "@/lib/knowledge/health"
import {
  audienceLabelMessage,
  labelAudiencesWithAi,
} from "@/lib/knowledge/label-audiences"

interface Report extends HealthReport {
  orphans: { total: number; items: Array<{ id: string; filename: string }> }
}

const KIND_LABEL: Record<HealthIssueKind, string> = {
  no_file: "Sin archivo",
  not_indexed: "Sin indexar",
  failed: "Error de indexación",
  stuck: "Indexación atascada",
  untagged: "Sin etiquetas",
  outdated: "Desactualizado",
}

/** Kinds that stop the assistant from using a document. */
const BLOCKING: HealthIssueKind[] = ["no_file", "not_indexed", "failed", "stuck"]

/**
 * Admin panel: what is wrong with the library and how to fix it, including
 * files that sit in the search index without a Library entry.
 */
export default function LibraryHealthPanel({
  chatbotId,
  refreshKey,
  onChanged,
  onShowFile,
  density = "card",
}: {
  chatbotId: string
  /** Changes whenever the library was reloaded. */
  refreshKey: number
  onChanged: () => void
  onShowFile: (fileName: string) => void
  /** `row` sits inside the Biblioteca status strip; `card` is a standalone block. */
  density?: "card" | "row"
}) {
  const { toast } = useToast()
  const [report, setReport] = useState<Report | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<HealthIssue | null>(null)
  const [confirmOrphans, setConfirmOrphans] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/files/health?chatbotId=${chatbotId}`, {
        cache: "no-store",
      })
      if (res.ok) setReport(await res.json())
    } catch (error) {
      console.error("Error loading library health:", error)
    }
  }, [chatbotId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const fail = (error: unknown) =>
    toast({
      title: "Error",
      description: error instanceof Error ? error.message : "Error",
      variant: "destructive",
    })

  const retry = async (issue: HealthIssue) => {
    setBusy(issue.fileId)
    try {
      const res = await fetch(`/api/files/${issue.fileId}/sync`, { method: "POST" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo reindexar")
      toast({ description: "El documento se está indexando de nuevo." })
      onChanged()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(null)
    }
  }

  const remove = async (issue: HealthIssue) => {
    setBusy(issue.fileId)
    try {
      const res = await fetch(`/api/files/${issue.fileId}`, { method: "DELETE" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo eliminar")
      toast({ description: data.warning ?? "Entrada eliminada." })
      onChanged()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(null)
    }
  }

  const suggestAudience = async () => {
    setBusy("suggest")
    try {
      const { labeled, failed } = await labelAudiencesWithAi(chatbotId)
      toast({ description: audienceLabelMessage(labeled, failed) })
      onChanged()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(null)
    }
  }

  const removeOrphans = async () => {
    if (!report) return
    setBusy("orphans")
    try {
      const res = await fetch("/api/files/health", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "remove_orphans",
          chatbotId,
          fileIds: report.orphans.items.map((o) => o.id),
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo limpiar el índice")
      toast({ description: `${data.removed} archivos quitados del índice.` })
      await load()
    } catch (error) {
      fail(error)
    } finally {
      setBusy(null)
    }
  }

  if (!report) return null

  const blocking = report.issues.filter((i) => BLOCKING.includes(i.kind))
  const attention = blocking.length + report.orphans.total
  const healthy = attention === 0

  const pending = report.issues.length + report.orphans.total
  const summary =
    density === "row" ? (
      pending === 0 ? "Nada que corregir" : `${pending} pendientes`
    ) : (
      <>
        {report.totals.documents} documentos · {report.totals.ready} listos para
        responder
        {attention > 0 ? ` · ${attention} necesitan atención` : " · todo en orden"}
        {report.issues.some((i) => i.kind === "untagged")
          ? ` · ${report.issues.filter((i) => i.kind === "untagged").length} sin etiquetas`
          : ""}
      </>
    )

  return (
    <div
      className={
        density === "row"
          ? "border-b px-3 py-2 last:border-b-0"
          : "mt-4 rounded-lg border p-4"
      }
      data-testid="library-health"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2">
          {(density === "row" ? pending === 0 : healthy) ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />
          ) : (
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
          )}
          <p className="min-w-0 text-sm leading-snug">
            <span className="font-medium">
              {density === "row" ? "Qué corregir" : "Salud de la biblioteca"}
            </span>
            <span className="text-muted-foreground"> · {summary}</span>
          </p>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" />
        )}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          {report.issues.length === 0 && report.orphans.total === 0 && (
            <p className="text-sm text-muted-foreground">No hay nada que corregir.</p>
          )}

          {report.issues.some((issue) => issue.kind === "untagged") && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                Los documentos sin audiencia se pueden leer y etiquetar sin volver a subirlos.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy !== null}
                onClick={() => void suggestAudience()}
              >
                {busy === "suggest" ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-2 h-4 w-4" />
                )}
                Sugerir con IA
              </Button>
            </div>
          )}

          {report.issues.length > 0 && (
            <ul className="divide-y rounded-md border">
              {report.issues.map((issue) => (
                <li
                  key={`${issue.kind}-${issue.fileId}`}
                  className="flex flex-wrap items-start justify-between gap-3 p-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        variant="secondary"
                        className={
                          BLOCKING.includes(issue.kind)
                            ? "bg-red-100 text-red-800"
                            : "bg-amber-100 text-amber-800"
                        }
                      >
                        {KIND_LABEL[issue.kind]}
                      </Badge>
                      <span className="break-words text-sm font-medium">
                        {issue.fileName}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{issue.detail}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    {busy === issue.fileId ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        {issue.actions.includes("retry") && (
                          <Button size="sm" variant="outline" onClick={() => retry(issue)}>
                            <RefreshCw className="mr-1 h-3.5 w-3.5" />
                            Reintentar
                          </Button>
                        )}
                        {issue.actions.includes("edit") && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onShowFile(issue.fileName)}
                          >
                            <Search className="mr-1 h-3.5 w-3.5" />
                            Ver en la lista
                          </Button>
                        )}
                        {issue.actions.includes("delete") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => setDeleteTarget(issue)}
                            aria-label={`Eliminar ${issue.fileName}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {report.orphans.total > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-3 dark:bg-amber-950/20">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    {report.orphans.total} archivos en el índice sin entrada en la
                    biblioteca
                  </p>
                  <p className="text-sm text-muted-foreground">
                    El asistente los usa, pero no se pueden abrir desde las fuentes ni
                    se filtran por audiencia. Suelen ser copias antiguas.
                  </p>
                  <ul className="mt-2 list-disc pl-5 text-sm">
                    {report.orphans.items.slice(0, 6).map((o) => (
                      <li key={o.id} className="break-words">
                        {o.filename}
                      </li>
                    ))}
                  </ul>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === "orphans"}
                  onClick={() => setConfirmOrphans(true)}
                >
                  {busy === "orphans" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Quitar del índice
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      <AlertDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(value) => {
          if (!value) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar de la biblioteca</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará «{deleteTarget?.fileName}» de la biblioteca y del índice de
              búsqueda.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteTarget) void remove(deleteTarget)
                setDeleteTarget(null)
              }}
            >
              Eliminar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={confirmOrphans} onOpenChange={setConfirmOrphans}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitar archivos del índice</AlertDialogTitle>
            <AlertDialogDescription>
              Los {report.orphans.items.length} archivos listados dejarán de usarse en las
              respuestas y se borrarán de OpenAI. Las entradas de la biblioteca no se
              tocan. No se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOrphans(false)
                void removeOrphans()
              }}
            >
              Quitar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

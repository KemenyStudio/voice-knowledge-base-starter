"use client"

import { useCallback, useEffect, useState } from "react"
import { BellRing, ChevronDown, ChevronUp, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useToast } from "@/hooks/use-toast"

interface AlertItem {
  id: string
  source: string
  score: number | null
  publishedAt: string | null
  newFile: { id: string; name: string }
  oldFile: { id: string; name: string }
}

interface FileOption {
  id: string
  file_name: string
}

const post = (body: Record<string, unknown>) =>
  fetch("/api/alerts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

/**
 * Admin panel of the Biblioteca: suggested "this replaces that" pairs found
 * when a document is uploaded, and a way to declare one by hand. Nothing is
 * announced until an admin confirms.
 */
export default function ChangeAlertsPanel({
  chatbotId,
  files,
  refreshKey,
  onChanged,
  density = "card",
}: {
  chatbotId: string
  files: FileOption[]
  refreshKey: number
  onChanged: () => void
  /** `row` sits inside the Biblioteca status strip; `card` is a standalone block. */
  density?: "card" | "row"
}) {
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<AlertItem[]>([])
  const [published, setPublished] = useState<AlertItem[]>([])
  const [confirming, setConfirming] = useState<AlertItem | null>(null)
  const [preview, setPreview] = useState<{ recipients: number; emailOptIn: number } | null>(null)
  const [sendEmails, setSendEmails] = useState(false)
  const [busy, setBusy] = useState(false)
  const [newId, setNewId] = useState("")
  const [oldId, setOldId] = useState("")

  const load = useCallback(() => {
    fetch(`/api/alerts?chatbotId=${chatbotId}&scope=review`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return
        setPending(data.pending ?? [])
        setPublished(data.published ?? [])
      })
      .catch(() => undefined)
  }, [chatbotId])

  useEffect(load, [load, refreshKey])

  const startConfirm = async (item: AlertItem) => {
    setConfirming(item)
    setPreview(null)
    setSendEmails(false)
    const res = await post({ action: "preview", chatbotId, alertId: item.id })
    if (res.ok) setPreview(await res.json())
  }

  const run = async (body: Record<string, unknown>, done: (data: any) => string) => {
    setBusy(true)
    try {
      const res = await post({ chatbotId, ...body })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo completar la acción")
      toast({ description: done(data) })
      setConfirming(null)
      load()
      onChanged()
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error",
        variant: "destructive",
      })
    } finally {
      setBusy(false)
    }
  }

  const summary =
    pending.length > 0
      ? `${pending.length} posible${pending.length === 1 ? "" : "s"} reemplazo${pending.length === 1 ? "" : "s"} por revisar`
      : "Avisa a quienes consultaron un documento cuando sale una versión nueva"

  return (
    <div
      className={
        density === "row"
          ? "border-b px-3 py-2 last:border-b-0"
          : "mt-4 rounded-lg border p-4"
      }
      data-testid="change-alerts-panel"
    >
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <div className="flex min-w-0 items-center gap-2">
          <BellRing className="h-4 w-4 shrink-0 text-blue-600" />
          <p className="min-w-0 text-sm leading-snug">
            <span className="font-medium">Avisos de cambios</span>
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
          {pending.length > 0 && (
            <ul className="divide-y rounded-md border" data-testid="pending-alerts">
              {pending.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start justify-between gap-3 p-3">
                  <p className="min-w-0 flex-1 text-sm">
                    <strong>{item.newFile.name}</strong> parece reemplazar a{" "}
                    <strong>{item.oldFile.name}</strong>
                    {item.source === "detected" && item.score != null
                      ? ` (parecido ${Math.round(item.score * 100)}%)`
                      : " (indicado por un administrador)"}
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => startConfirm(item)} disabled={busy}>
                      Confirmar reemplazo
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() =>
                        run({ action: "dismiss", alertId: item.id }, () => "Sugerencia descartada.")
                      }
                    >
                      No es un reemplazo
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm font-medium">Indicar un reemplazo manualmente</p>
            <div className="grid gap-2 md:grid-cols-2">
              <select
                aria-label="Documento nuevo"
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
                value={newId}
                onChange={(e) => setNewId(e.target.value)}
              >
                <option value="">Documento nuevo…</option>
                {files.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.file_name.slice(0, 90)}
                  </option>
                ))}
              </select>
              <select
                aria-label="Documento que reemplaza"
                className="rounded-md border bg-background px-2 py-1.5 text-sm"
                value={oldId}
                onChange={(e) => setOldId(e.target.value)}
              >
                <option value="">Documento anterior…</option>
                {files
                  .filter((f) => f.id !== newId)
                  .map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.file_name.slice(0, 90)}
                    </option>
                  ))}
              </select>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={!newId || !oldId || busy}
              onClick={() =>
                run({ action: "create", newFileId: newId, oldFileId: oldId }, () => {
                  setNewId("")
                  setOldId("")
                  return "Reemplazo agregado a la lista para confirmar."
                })
              }
            >
              Agregar a la lista
            </Button>
          </div>

          {published.length > 0 && (
            <div>
              <p className="mb-1 text-sm font-medium">Publicados recientemente</p>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {published.map((item) => (
                  <li key={item.id}>
                    {item.newFile.name} reemplaza a {item.oldFile.name}
                    {item.publishedAt
                      ? ` · ${new Date(item.publishedAt).toLocaleDateString("es-MX")}`
                      : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <Dialog open={Boolean(confirming)} onOpenChange={(next) => !next && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirmar reemplazo</DialogTitle>
            <DialogDescription>
              «{confirming?.newFile.name}» sustituye a «{confirming?.oldFile.name}». El
              documento anterior se marcará como desactualizado (seguirá en la Biblioteca)
              y se avisará dentro del chat a quienes lo vieron en sus respuestas.
            </DialogDescription>
          </DialogHeader>
          {preview === null ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Calculando a quién avisar…
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <p data-testid="alert-audience">
                {preview.recipients} {preview.recipients === 1 ? "persona vio" : "personas vieron"} el
                documento anterior en sus respuestas; {preview.emailOptIn}{" "}
                {preview.emailOptIn === 1 ? "activó" : "activaron"} los avisos por correo.
              </p>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={sendEmails}
                  disabled={preview.emailOptIn === 0}
                  onChange={(e) => setSendEmails(e.target.checked)}
                />
                <span>
                  Enviar también un correo a quienes lo activaron ({preview.emailOptIn}). No se
                  envía a nadie más.
                </span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button
              disabled={busy || preview === null}
              onClick={() =>
                confirming &&
                run(
                  { action: "publish", alertId: confirming.id, sendEmails },
                  (data) =>
                    `Aviso publicado para ${data.recipients} personas${data.emailed ? ` (${data.emailed} correos)` : ""}.`
                )
              }
            >
              {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { ChevronDown, ChevronUp, Loader2, Radar } from "lucide-react"

import { DocumentPreviewDialog } from "@/components/chat/DocumentPreview"
import { Button } from "@/components/ui/button"
import { sourceLabel, type SourceId, type SourceReport } from "@/lib/watch/sources"

interface Proposal {
  id: string
  source: SourceId
  title: string
  url: string
  publishedOn: string | null
  organ: string | null
}

interface OpenPreview {
  title: string
  url: string
  sandboxed: boolean
  proposalId: string | null
  objectUrl: string | null
}

const UNAVAILABLE =
  "No se pudo obtener el archivo oficial. No se agregó a la biblioteca."

function hintPage(): string {
  return URL.createObjectURL(
    new Blob(
      [
        "<!doctype html><html lang=es><meta charset=utf-8><body style=\"font-family:system-ui,sans-serif;padding:24px;color:#333\"><p>Se obtuvo el archivo oficial. Este formato no se puede mostrar en la página. Puedes agregarlo a la biblioteca.</p></body></html>",
      ],
      { type: "text/html" }
    )
  )
}

export function SourceWatchPanel({
  chatbotId,
  scanSignal = 0,
  onChanged,
}: {
  chatbotId: string
  /** Increments when the Biblioteca actions menu asks for a scan. */
  scanSignal?: number
  onChanged?: () => void
}) {
  const [proposals, setProposals] = useState<Proposal[] | null>(null)
  const [reports, setReports] = useState<SourceReport[]>([])
  const [busy, setBusy] = useState(false)
  const [openingId, setOpeningId] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [preview, setPreview] = useState<OpenPreview | null>(null)
  const [open, setOpen] = useState(false)
  const seenSignal = useRef(0)
  const scanRef = useRef<() => Promise<void>>(async () => undefined)

  const load = useCallback(async () => {
    const response = await fetch(`/api/watch?chatbotId=${chatbotId}`)
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(payload.error || "No se pudo cargar.")
    setProposals(payload.proposals ?? [])
  }, [chatbotId])

  useEffect(() => {
    void load().catch((error) => setNote((error as Error).message))
  }, [load])

  const replacePreview = (next: OpenPreview | null) => {
    setPreview((current) => {
      if (current?.objectUrl && current.objectUrl !== next?.objectUrl) {
        URL.revokeObjectURL(current.objectUrl)
      }
      return next
    })
  }

  const closePreview = () => replacePreview(null)

  const scan = async () => {
    setBusy(true)
    setNote(null)
    try {
      const response = await fetch("/api/watch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || "No se pudo revisar.")
      setProposals(payload.proposals ?? [])
      setReports(payload.reports ?? [])
      setNote(payload.note || "No hubo documentos nuevos para agregar.")
      if (payload.ingested > 0) onChanged?.()
    } catch (error) {
      setNote((error as Error).message)
    } finally {
      setBusy(false)
    }
  }

  scanRef.current = scan

  useEffect(() => {
    if (scanSignal === 0 || scanSignal === seenSignal.current) return
    seenSignal.current = scanSignal
    setOpen(true)
    void scanRef.current()
  }, [scanSignal])

  const dismiss = async (id: string) => {
    const response = await fetch("/api/watch", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatbotId, id, status: "dismissed" }),
    })
    if (!response.ok) return
    setProposals((current) => (current ?? []).filter((item) => item.id !== id))
    if (preview?.proposalId === id) closePreview()
  }

  const openItem = async (item: Proposal) => {
    setOpeningId(item.id)
    setNote(null)
    try {
      const response = await fetch(
        `/api/watch/preview?chatbotId=${chatbotId}&id=${item.id}`
      )
      const type = response.headers.get("content-type") || ""
      if (!response.ok) {
        setNote(UNAVAILABLE)
        return
      }
      if (type.includes("application/json")) {
        const payload = await response.json().catch(() => ({}))
        if (payload.fileId) {
          replacePreview({
            title: payload.title || item.title,
            url: `/api/files/${payload.fileId}/download`,
            sandboxed: false,
            proposalId: null,
            objectUrl: null,
          })
          return
        }
        if (payload.ok && payload.previewInline === false) {
          const objectUrl = hintPage()
          replacePreview({
            title: item.title,
            url: objectUrl,
            sandboxed: true,
            proposalId: item.id,
            objectUrl,
          })
          return
        }
        setNote(UNAVAILABLE)
        return
      }
      const objectUrl = URL.createObjectURL(await response.blob())
      replacePreview({
        title: item.title,
        url: objectUrl,
        sandboxed: type.includes("html"),
        proposalId: item.id,
        objectUrl,
      })
    } catch {
      setNote(UNAVAILABLE)
    } finally {
      setOpeningId(null)
    }
  }

  const addToLibrary = async () => {
    if (!preview?.proposalId) return
    setAdding(true)
    setNote(null)
    try {
      const response = await fetch("/api/watch/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatbotId, id: preview.proposalId }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || UNAVAILABLE)
      const proposalId = preview.proposalId
      setProposals((current) => (current ?? []).filter((item) => item.id !== proposalId))
      if (payload.status === "ingested" && payload.file?.id) {
        replacePreview({
          title: payload.file.file_name || preview.title,
          url: `/api/files/${payload.file.id}/download`,
          sandboxed: false,
          proposalId: null,
          objectUrl: null,
        })
        setNote("Se agregó el documento a la biblioteca.")
        onChanged?.()
        return
      }
      closePreview()
      setNote("Ese título ya está en la biblioteca y no se reemplazó.")
      onChanged?.()
    } catch (error) {
      setNote((error as Error).message)
    } finally {
      setAdding(false)
    }
  }

  const proposalCount = proposals?.length ?? 0
  const closedSummary =
    proposals == null
      ? "Cargando propuestas"
      : proposalCount === 0
        ? "Sin propuestas"
        : proposalCount === 1
          ? "1 propuesta"
          : `${proposalCount} propuestas`

  return (
    <div className="border-b px-3 py-2 text-sm" data-testid="source-watch">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 text-left"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <p className="flex min-w-0 items-center gap-2">
          <Radar className="h-4 w-4 shrink-0 text-blue-500" />
          <span className="font-medium">Vigilancia de fuentes</span>
          <span className="text-muted-foreground">
            · {busy ? "Buscando…" : closedSummary}
          </span>
        </p>
        {open ? (
          <ChevronUp className="h-4 w-4 shrink-0" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0" />
        )}
      </button>
      {!open && note && <p className="mt-1 text-xs text-muted-foreground">{note}</p>}
      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              Revisa el Diario Oficial (Hacienda, CNBV y Banxico), la página de documentos
              de la CNBV y las consultas de Banxico. Si el archivo oficial se puede obtener,
              se agrega a esta biblioteca. Un título que ya está no se reemplaza.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={scan} disabled={busy}>
              {busy && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Buscar documentos nuevos
            </Button>
          </div>
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          {reports.some((report) => report.error) && (
            <ul className="text-xs text-destructive">
              {reports
                .filter((report) => report.error)
                .map((report) => (
                  <li key={report.source}>{report.error}</li>
                ))}
            </ul>
          )}
          {proposals && proposals.length > 0 && (
            <ul className="space-y-2">
              {proposals.map((item) => (
                <li key={item.id} className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      disabled={openingId === item.id}
                      className="text-left font-medium underline-offset-2 hover:underline"
                    >
                      {openingId === item.id && (
                        <Loader2 className="mr-1 inline h-3.5 w-3.5 animate-spin" />
                      )}
                      {item.title}
                    </button>
                    <p className="text-xs text-muted-foreground">
                      {sourceLabel(item.source)}
                      {item.organ ? ` · ${item.organ}` : ""}
                      {item.publishedOn ? ` · ${item.publishedOn}` : ""}
                    </p>
                  </div>
                  <Button type="button" size="sm" variant="ghost" onClick={() => dismiss(item.id)}>
                    Descartar
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {proposals && proposals.length === 0 && (
            <p className="text-xs text-muted-foreground">No hay documentos pendientes.</p>
          )}
        </div>
      )}
      <DocumentPreviewDialog
        title={preview?.title ?? "Documento"}
        url={preview?.url ?? null}
        sandboxed={preview?.sandboxed ?? false}
        onClose={closePreview}
        footer={
          preview?.proposalId ? (
            <Button type="button" size="sm" onClick={addToLibrary} disabled={adding}>
              {adding && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              Agregar a la biblioteca
            </Button>
          ) : null
        }
      />
    </div>
  )
}

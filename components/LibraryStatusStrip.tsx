"use client"

import { useCallback, useEffect, useState } from "react"
import { ChevronDown, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { LibrarySummary } from "@/lib/knowledge/library-summary"

const numberFormat = new Intl.NumberFormat("es-MX")

interface LibraryStatusStripProps {
  chatbotId: string
  refreshKey: number
  busy: "suggest" | "accept" | "tags" | "metadata" | null
  canSuggest: boolean
  canAccept: boolean
  canImport: boolean
  suggested: number
  onUpload: () => void
  onSuggest: () => void
  onAccept: () => void
  onImportTags: () => void
  onFillMetadata: () => void
  onScan: () => void
}

function Stat({
  label,
  value,
  tone,
  title,
}: {
  label: string
  value: string
  tone?: "warn" | "ok"
  title?: string
}) {
  const toneClass =
    tone === "warn"
      ? "text-amber-700 dark:text-amber-400"
      : tone === "ok"
        ? "text-emerald-700 dark:text-emerald-400"
        : "text-foreground"
  return (
    <div className="min-w-[7.5rem]" title={title}>
      <dt className="text-[11px] font-medium leading-4 text-muted-foreground">{label}</dt>
      <dd className={`mt-1.5 text-[2rem] font-semibold tabular-nums leading-none tracking-tight ${toneClass}`}>
        {value}
      </dd>
    </div>
  )
}

/**
 * First thing an admin sees in Biblioteca: real counts, then one quality
 * line, then a single actions menu.
 */
export default function LibraryStatusStrip({
  chatbotId,
  refreshKey,
  busy,
  canSuggest,
  canAccept,
  canImport,
  suggested,
  onUpload,
  onSuggest,
  onAccept,
  onImportTags,
  onFillMetadata,
  onScan,
}: LibraryStatusStripProps) {
  const [summary, setSummary] = useState<LibrarySummary | null>(null)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/files/summary?chatbotId=${encodeURIComponent(chatbotId)}`,
        { cache: "no-store" }
      )
      if (!response.ok) throw new Error("summary")
      setSummary((await response.json()) as LibrarySummary)
      setFailed(false)
    } catch (error) {
      console.error("Error:", error)
      setFailed(true)
    }
  }, [chatbotId])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const counts = summary?.counts
  const indexLabel =
    counts?.indexFiles == null ? "—" : numberFormat.format(counts.indexFiles)

  return (
    <div className="border-b px-4 py-4" data-testid="library-summary">
      {counts ? (
        <>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3 xl:grid-cols-6">
            <Stat label="Documentos" value={numberFormat.format(counts.documents)} />
            <Stat
              label="En el índice"
              value={indexLabel}
              title="Archivos completados en el índice de búsqueda. El total de fragmentos de texto no viene en esa API."
            />
            <Stat
              label="Listos"
              value={numberFormat.format(counts.ready)}
              tone={counts.needsAttention === 0 ? "ok" : undefined}
            />
            <Stat
              label="Necesitan atención"
              value={numberFormat.format(counts.needsAttention)}
              tone={counts.needsAttention > 0 ? "warn" : undefined}
            />
            <Stat
              label="Sin audiencia"
              value={numberFormat.format(counts.missingAudience)}
              tone={counts.missingAudience > 0 ? "warn" : undefined}
            />
            <Stat
              label="Índice débil"
              value={numberFormat.format(counts.weakIndex)}
              tone={counts.weakIndex > 0 ? "warn" : undefined}
              title="Puntuación de índice menor a 70."
            />
          </dl>
          <p className="mt-4 max-w-3xl text-xs leading-relaxed text-muted-foreground" data-testid="library-quality">
            {summary.quality}
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {failed ? "No se pudo cargar el resumen." : "Cargando el resumen…"}
        </p>
      )}
      {(counts || failed) && (
        <div className="mt-2 flex justify-end">
          <ActionsMenu
            busy={busy}
            canSuggest={canSuggest}
            canAccept={canAccept}
            canImport={canImport}
            suggested={suggested}
            onUpload={onUpload}
            onSuggest={onSuggest}
            onAccept={onAccept}
            onImportTags={onImportTags}
            onFillMetadata={onFillMetadata}
            onScan={onScan}
          />
        </div>
      )}
    </div>
  )
}

function ActionsMenu({
  busy,
  canSuggest,
  canAccept,
  canImport,
  suggested,
  onUpload,
  onSuggest,
  onAccept,
  onImportTags,
  onFillMetadata,
  onScan,
}: Omit<LibraryStatusStripProps, "chatbotId" | "refreshKey">) {
  const locked = busy !== null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0"
          aria-label="Acciones de la biblioteca"
        >
          {locked ? (
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          ) : (
            <ChevronDown className="mr-2 h-3.5 w-3.5" />
          )}
          Acciones
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={onUpload}>Subir documento</DropdownMenuItem>
        <DropdownMenuItem disabled={locked || !canSuggest} onSelect={onSuggest}>
          Sugerir con IA
        </DropdownMenuItem>
        <DropdownMenuItem disabled={locked || !canAccept} onSelect={onAccept}>
          Aceptar sugerencias{suggested > 0 ? ` (${suggested})` : ""}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={locked || !canImport} onSelect={onImportTags}>
          Importar de las etiquetas
        </DropdownMenuItem>
        <DropdownMenuItem disabled={locked} onSelect={onFillMetadata}>
          Completar metadatos vacíos
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onScan}>Buscar documentos nuevos</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

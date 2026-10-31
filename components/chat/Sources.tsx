"use client"

import { useState } from "react"
import { FileText, MoreHorizontal } from "lucide-react"

import { DocumentPreviewDialog } from "@/components/chat/DocumentPreview"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import type { DocumentAction } from "@/lib/document-actions"

import {
  describeReference,
  type ParsedReference,
} from "@/lib/chat/references"
import { cn } from "@/lib/utils"
import type { ChatCitation } from "@/types/knowledge"

export interface SourceItem {
  number: number
  title: string
  pages: string | null
  details: string[]
  url: string | null
  /** Library id of the cited document, when it is one. */
  fileId: string | null
  outdated?: boolean
}

/** Library id out of a download link such as /api/files/<id>/download. */
function fileIdOf(url: string | null | undefined): string | null {
  const match = url?.match(/\/api\/files\/([0-9a-f-]{36})/i)
  return match ? match[1] : null
}

/**
 * One entry per cited document. The model's own "Referencias" section supplies
 * pages and articles; the citation list supplies the real title and link.
 */
export function buildSources(
  references: ParsedReference[],
  citations: ChatCitation[],
  citedNumbers: Set<number>
): SourceItem[] {
  const byNumber = new Map<number, SourceItem>()

  for (const reference of references) {
    const described = describeReference(reference.text)
    const citation = citations.find((c) => c.number === reference.number)
    byNumber.set(reference.number, {
      number: reference.number,
      title: citation?.title || described.title || `Fuente ${reference.number}`,
      pages: described.pages,
      details: described.details,
      url: citation?.file_url ?? null,
      fileId: fileIdOf(citation?.file_url),
      outdated: citation?.outdated,
    })
  }
  for (const citation of citations) {
    if (!citedNumbers.has(citation.number) || byNumber.has(citation.number)) {
      continue
    }
    byNumber.set(citation.number, {
      number: citation.number,
      title: citation.title,
      pages: null,
      details: [],
      url: citation.file_url,
      fileId: fileIdOf(citation.file_url),
      outdated: citation.outdated,
    })
  }
  return Array.from(byNumber.values()).sort((a, b) => a.number - b.number)
}

interface SourcesProps {
  sources: SourceItem[]
  selectedCitation?: number | null
  onCitationClick?: (number: number | null) => void
  onDocumentAction?: (action: DocumentAction, source: SourceItem) => void
  onCheckValidity?: (source: SourceItem) => void
  onNewerSource?: (source: SourceItem) => void
}

export function Sources({
  sources,
  selectedCitation,
  onCitationClick,
  onDocumentAction,
  onCheckValidity,
  onNewerSource,
}: SourcesProps) {
  const [preview, setPreview] = useState<SourceItem | null>(null)
  if (sources.length === 0) return null

  return (
    <div className="mt-8 border-t border-border/80 pt-4">
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Fuentes
      </p>
      <ul className="space-y-3">
        {sources.map((source) => {
          const selected = selectedCitation === source.number
          return (
            <li key={source.number} className="flex items-start gap-2 text-sm">
              <button
                type="button"
                onClick={() =>
                  onCitationClick?.(selected ? null : source.number)
                }
                className={cn(
                  "mt-0.5 inline-flex h-5 min-w-5 flex-shrink-0 items-center justify-center rounded px-1 text-xs font-semibold",
                  selected
                    ? "bg-blue-600 text-white"
                    : "bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-900 dark:text-blue-100"
                )}
                aria-label={`Ver la fuente ${source.number}`}
              >
                {source.number}
              </button>
              <div className="min-w-0">
                <span className="break-words font-medium">{source.title}</span>
                {source.pages && (
                  <span className="ml-1 text-gray-500">
                    (páginas {source.pages})
                  </span>
                )}
                {source.url && (
                  <button
                    type="button"
                    onClick={() => setPreview(source)}
                    className="ml-2 inline-flex items-center align-middle text-blue-600 hover:text-blue-800"
                    title="Abrir documento"
                    aria-label={`Abrir documento ${source.title}`}
                  >
                    <FileText className="h-3.5 w-3.5" />
                  </button>
                )}
                {source.outdated && (
                  <span
                    className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800"
                    title="Un administrador marcó este documento como desactualizado"
                  >
                    Desactualizado
                  </span>
                )}
                {source.details.length > 0 && (
                  <p className="text-xs text-gray-500">
                    {source.details.join(" · ")}
                  </p>
                )}
              </div>
              {(onDocumentAction || onCheckValidity || onNewerSource) && source.fileId && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="ml-auto h-6 w-6 flex-shrink-0 text-gray-500"
                      aria-label={`Acciones para ${source.title}`}
                    >
                      <MoreHorizontal className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {onDocumentAction && (
                      <>
                        <DropdownMenuItem
                          onSelect={() => onDocumentAction("summarize", source)}
                        >
                          Resumir este documento
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => onDocumentAction("compare", source)}
                        >
                          Comparar con otro documento…
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() => onDocumentAction("changes", source)}
                        >
                          Ver qué cambió…
                        </DropdownMenuItem>
                      </>
                    )}
                    {onCheckValidity && (
                      <DropdownMenuItem onSelect={() => onCheckValidity(source)}>
                        Verificar vigencia
                      </DropdownMenuItem>
                    )}
                    {onNewerSource && (
                      <DropdownMenuItem onSelect={() => onNewerSource(source)}>
                        Fuente oficial más reciente
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          )
        })}
      </ul>
      <DocumentPreviewDialog
        title={preview?.title ?? "Documento"}
        url={preview?.url ?? null}
        onClose={() => setPreview(null)}
      />
    </div>
  )
}

"use client"

import { memo, useMemo, useState } from "react"
import { FileText, MessageSquarePlus } from "lucide-react"
import { motion } from "framer-motion"

import { DocumentPreviewDialog } from "@/components/chat/DocumentPreview"
import { Button } from "@/components/ui/button"
import {
  formatPassage,
  locationCaption,
  type PassageBlock,
} from "@/lib/chat/passage"
import { cn } from "@/lib/utils"
import type { CitationLocation } from "@/types/knowledge"

export interface Result {
  number: number
  title: string
  extract: string
  url: string
  location: CitationLocation
}

interface ResultsAreaProps {
  results: Result[]
  selectedCitation?: number | null
  onCitationClick?: (citationNumber: number | null) => void
  onAskAbout?: (result: Result) => void
}

export function ResultsArea({
  results,
  selectedCitation,
  onCitationClick,
  onAskAbout,
}: ResultsAreaProps) {
  const [preview, setPreview] = useState<Result | null>(null)

  return (
    <motion.div
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <div className="h-full flex-grow space-y-3 overflow-y-auto px-4 py-4">
        {results.length === 0 && (
          <p className="px-1 text-sm leading-6 text-muted-foreground">
            Aquí verás los fragmentos de los documentos en los que se basa cada
            respuesta.
          </p>
        )}
        {results.map((result) => (
          <ResultCard
            key={result.number}
            result={result}
            selectedCitation={selectedCitation}
            onCitationClick={onCitationClick}
            onAskAbout={onAskAbout}
            onOpen={() => setPreview(result)}
          />
        ))}
      </div>
      <DocumentPreviewDialog
        title={preview?.title ?? "Documento"}
        url={preview?.url || null}
        onClose={() => setPreview(null)}
      />
    </motion.div>
  )
}

interface ResultCardProps {
  result: Result
  selectedCitation?: number | null
  onCitationClick?: (citationNumber: number | null) => void
  onAskAbout?: (result: Result) => void
  onOpen: () => void
}

function PassageBody({ blocks }: { blocks: PassageBlock[] }) {
  return (
    <div data-testid="passage-body" className="mt-2.5 space-y-3">
      {blocks.map((block, index) => {
        switch (block.kind) {
          case "article":
            return (
              <section key={index}>
                <h4 className="text-sm font-semibold text-foreground">{block.label}</h4>
                {block.paragraphs.map((paragraph, paragraphIndex) => (
                  <p
                    key={paragraphIndex}
                    className="mt-1 text-[13px] leading-5 text-muted-foreground"
                  >
                    {paragraph}
                  </p>
                ))}
              </section>
            )
          case "paragraph":
            return (
              <p key={index} className="text-[13px] leading-5 text-muted-foreground">
                {block.text}
              </p>
            )
          default: {
            const unknown: never = block
            void unknown
            return null
          }
        }
      })}
    </div>
  )
}

const ResultCard = memo(function ResultCard({
  result,
  selectedCitation,
  onCitationClick,
  onAskAbout,
  onOpen,
}: ResultCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const isSelected = selectedCitation === result.number
  const extract = result.extract.trim()
  const blocks = useMemo(() => formatPassage(extract), [extract])
  const canExpand =
    extract.length > 140 || blocks.length > 1 || blocks.some((block) => block.kind === "article")

  return (
    <article
      id={`source-${result.number}`}
      className={cn(
        "rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-2 transition-colors dark:border-white/10 dark:bg-white/[0.03]",
        isSelected
          ? "border-blue-400 ring-2 ring-blue-500/70"
          : "border-border/80 hover:border-border"
      )}
    >
      <div className="flex items-start gap-2.5">
        <button
          type="button"
          onClick={() => onCitationClick?.(isSelected ? null : result.number)}
          className={cn(
            "mt-0.5 flex h-6 min-w-6 flex-shrink-0 items-center justify-center rounded-md px-1 text-xs font-semibold",
            isSelected
              ? "bg-blue-600 text-white"
              : "bg-blue-100 text-blue-800 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-100"
          )}
          title={
            isSelected
              ? "Clic para deseleccionar"
              : "Clic para resaltar en la respuesta"
          }
        >
          {result.number}
        </button>
        <h3 className="min-w-0 text-sm font-semibold leading-snug text-foreground">
          {result.title}
        </h3>
      </div>
      <p
        data-testid="passage-location"
        className="mt-1.5 text-xs leading-5 text-muted-foreground"
      >
        {locationCaption(result.location)}
      </p>
      {extract && !isExpanded && (
        <p className="mt-2.5 line-clamp-2 text-[13px] leading-5 text-muted-foreground">
          {extract}
        </p>
      )}
      {extract && isExpanded && <PassageBody blocks={blocks} />}
      {(canExpand || result.url || (isSelected && onAskAbout)) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1">
          {canExpand ? (
            <Button
              variant="ghost"
              onClick={() => setIsExpanded(!isExpanded)}
              className="h-auto px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {isExpanded ? "Cerrar" : "Leer más"}
            </Button>
          ) : (
            <span />
          )}
          {isSelected && onAskAbout && extract && (
            <Button
              variant="ghost"
              data-testid="preguntar-sobre-esto"
              onClick={() => onAskAbout(result)}
              className="h-auto px-2 py-1 text-xs text-blue-700 hover:text-blue-800 dark:text-blue-300"
            >
              <MessageSquarePlus className="mr-1.5 h-3.5 w-3.5" />
              Preguntar sobre esto
            </Button>
          )}
          {result.url && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto h-auto px-2 py-1 text-xs text-blue-700 hover:text-blue-800 dark:text-blue-300"
              onClick={onOpen}
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              Abrir documento
            </Button>
          )}
        </div>
      )}
    </article>
  )
})

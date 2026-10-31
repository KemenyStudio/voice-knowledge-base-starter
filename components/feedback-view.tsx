"use client"

import { Fragment, useCallback, useEffect, useMemo, useState } from "react"
import { motion } from "framer-motion"
import {
  Check,
  ChevronDown,
  FilePlus2,
  Flag,
  Loader2,
  NotebookPen,
  RotateCcw,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { cn } from "@/lib/utils"

interface Source {
  title: string
  fileId: string | null
}

interface Evaluation {
  id: string
  userId: string
  userEmail: string
  chatbotId: string
  chatbotName: string
  question?: string
  response: string
  rating: number
  comment: string
  sources: Source[]
  triage: { status: string; action: string | null; note: string | null }
  timestamp: number
}

interface UnsourcedAnswer {
  id: string
  userId: string
  userEmail: string
  chatbotId: string
  chatbotName: string
  question?: string
  response: string
  timestamp: number
}

interface Summary {
  ratings: number
  positive: number
  low: number
  open: number
  ratedWithoutSources: number
  answers: number
  answersWithoutSources: number
}

type RatingFilter = "negative" | "all" | "positive"
type StatusFilter = "open" | "all" | "resolved"
type TriageAction =
  | "outdated_document"
  | "prompt_note"
  | "request_document"
  | "dismiss"
  | "resolve"
  | "reopen"

const NO_SOURCES = "Sin fuentes"
const EMPTY_SUMMARY: Summary = {
  ratings: 0,
  positive: 0,
  low: 0,
  open: 0,
  ratedWithoutSources: 0,
  answers: 0,
  answersWithoutSources: 0,
}

const ACTION_LABEL: Record<string, string> = {
  outdated_document: "Documento marcado como desactualizado",
  prompt_note: "Nota agregada al asistente",
  request_document: "Documento solicitado",
  dismissed: "Descartada",
}

function formatWhen(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  })
}

function formatDate(timestamp: number) {
  return new Date(timestamp * 1000).toLocaleDateString("es-MX", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

function clip(text: string, max = 140) {
  const clean = text.replace(/\s+/g, " ").trim()
  return clean.length <= max ? clean : `${clean.slice(0, max)}…`
}

function Meter({
  label,
  value,
  total,
  barClass,
}: {
  label: string
  value: number
  total: number
  barClass: string
}) {
  const width = total === 0 ? 0 : Math.round((value / total) * 100)
  return (
    <div className="grid grid-cols-[7.5rem_1fr_2.5rem] items-center gap-3 text-sm">
      <span className="text-[#4b5563] dark:text-gray-400">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-[#eef0f3] dark:bg-zinc-800">
        <span
          className={cn("block h-full rounded-full", barClass)}
          style={{ width: `${width}%` }}
        />
      </span>
      <span className="text-right tabular-nums text-[#111827] dark:text-gray-100">{value}</span>
    </div>
  )
}

function Stat({
  label,
  value,
  hint,
  tone,
  onClick,
}: {
  label: string
  value: number
  hint: string
  tone: string
  onClick?: () => void
}) {
  const className =
    "w-full rounded-xl border border-[#e7e9ee] bg-white px-4 py-3 text-left dark:border-zinc-800 dark:bg-zinc-950"
  const body = (
    <>
      <span className="flex items-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", tone)} />
        <span className="text-[11px] font-medium uppercase tracking-wide text-[#6b7280]">{label}</span>
      </span>
      <span className="mt-1 block text-[28px] font-semibold leading-none tabular-nums text-[#111827] dark:text-gray-50">
        {value}
      </span>
      <span className="mt-1.5 block text-xs text-[#6b7280]">{hint}</span>
    </>
  )
  if (!onClick) return <div className={className}>{body}</div>
  return (
    <button type="button" className={className} onClick={onClick}>
      {body}
    </button>
  )
}

function Section({
  id,
  title,
  detail,
  children,
}: {
  id?: string
  title: string
  detail?: string
  children: React.ReactNode
}) {
  return (
    <section
      id={id}
      className="min-w-0 max-w-full overflow-hidden rounded-xl border border-[#e7e9ee] bg-white dark:border-zinc-800 dark:bg-zinc-950"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#eef0f3] px-4 py-3 dark:border-zinc-800">
        <h3 className="text-sm font-semibold text-[#111827] dark:text-gray-100">{title}</h3>
        {detail && <p className="text-xs text-[#6b7280]">{detail}</p>}
      </div>
      {children}
    </section>
  )
}

/** Admin view: how the assistants are answering, and what to do about a rating. */
export default function FeedbackView() {
  const { toast } = useToast()
  const [items, setItems] = useState<Evaluation[]>([])
  const [unsourced, setUnsourced] = useState<UnsourcedAnswer[]>([])
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY)
  const [loading, setLoading] = useState(true)
  const [ratingFilter, setRatingFilter] = useState<RatingFilter>("all")
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all")
  const [documentFilter, setDocumentFilter] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [dialog, setDialog] = useState<{
    item: Evaluation
    action: "outdated_document" | "prompt_note" | "request_document"
  } | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/response_feedback", { cache: "no-store" })
      const data = await response.json()
      const nextItems = (data.items ?? []) as Evaluation[]
      setItems(nextItems)
      setUnsourced((data.unsourced ?? []) as UnsourcedAnswer[])
      setSummary(
        data.summary ?? {
          ...EMPTY_SUMMARY,
          ratings: nextItems.length,
          positive: nextItems.filter((item) => item.rating === 1).length,
          low: nextItems.filter((item) => item.rating === -1).length,
          open: nextItems.filter((item) => item.triage.status !== "resolved").length,
          ratedWithoutSources: nextItems.filter((item) => item.sources.length === 0).length,
        }
      )
    } catch (error) {
      console.error("Error fetching feedback:", error)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openLowItems = useMemo(
    () => items.filter((item) => item.rating === -1 && item.triage.status === "open"),
    [items]
  )

  const byAssistant = useMemo(() => {
    const rows = new Map<string, { name: string; total: number; low: number; unsourced: number }>()
    for (const item of items) {
      const key = item.chatbotId || item.chatbotName || "asistente"
      const row = rows.get(key) ?? {
        name: item.chatbotName || "Asistente",
        total: 0,
        low: 0,
        unsourced: 0,
      }
      row.total += 1
      if (item.rating === -1) row.low += 1
      if (item.sources.length === 0) row.unsourced += 1
      rows.set(key, row)
    }
    return Array.from(rows.values()).sort((a, b) => b.low - a.low || b.total - a.total)
  }, [items])

  const documentGroups = useMemo(() => {
    const counts = new Map<string, number>()
    for (const item of items) {
      const titles = item.sources.length
        ? Array.from(new Set(item.sources.map((source) => source.title)))
        : [NO_SOURCES]
      for (const title of titles) counts.set(title, (counts.get(title) ?? 0) + 1)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [items])

  const visible = useMemo(
    () =>
      items.filter((item) => {
        const ratingOk =
          ratingFilter === "all" ||
          (ratingFilter === "negative" ? item.rating === -1 : item.rating === 1)
        const statusOk = statusFilter === "all" || item.triage.status === statusFilter
        const documentOk = !documentFilter
          ? true
          : documentFilter === NO_SOURCES
            ? item.sources.length === 0
            : item.sources.some((source) => source.title === documentFilter)
        return ratingOk && statusOk && documentOk
      }),
    [items, ratingFilter, statusFilter, documentFilter]
  )

  const ratingByMessage = useMemo(() => {
    const map = new Map<string, Evaluation>()
    for (const item of items) {
      const current = map.get(item.id)
      if (!current || item.rating === -1) map.set(item.id, item)
    }
    return map
  }, [items])

  const send = async (
    item: Evaluation,
    action: TriageAction,
    extra: { fileId?: string; note?: string; notifyUser?: boolean; userMessage?: string } = {}
  ) => {
    setBusyId(item.id + item.userId)
    try {
      const response = await fetch("/api/response_feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId: item.id, userId: item.userId, action, ...extra }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "No se pudo completar la acción")
      toast({
        description: data.emailed ? "Listo. Se envió un correo al usuario." : "Listo.",
      })
      await load()
      return true
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error",
        variant: "destructive",
      })
      return false
    } finally {
      setBusyId(null)
    }
  }

  const handleExport = () => {
    const headers = ["Asistente", "Usuario", "Pregunta", "Respuesta", "Evaluación", "Comentario", "Fuentes", "Estado", "Acción", "Fecha"]
    const rows = items.map((ev) => [
      ev.chatbotName,
      ev.userEmail,
      ev.question ?? "",
      ev.response,
      ev.rating === 1 ? "Positiva" : "Baja",
      ev.comment,
      ev.sources.map((source) => source.title).join("; "),
      ev.triage.status === "resolved" ? "Resuelta" : "Pendiente",
      ev.triage.action ? ACTION_LABEL[ev.triage.action] ?? ev.triage.action : "",
      formatWhen(ev.timestamp),
    ])
    const csvContent = [headers, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n")
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.setAttribute("download", "feedback.csv")
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  const focusRatings = (rating: RatingFilter, status: StatusFilter, documentTitle: string | null) => {
    setRatingFilter(rating)
    setStatusFilter(status)
    setDocumentFilter(documentTitle)
    window.document.getElementById("valoraciones")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  const Toggle = <T extends string>({
    value,
    current,
    onSelect,
    children,
  }: {
    value: T
    current: T
    onSelect: (value: T) => void
    children: React.ReactNode
  }) => (
    <Button
      size="sm"
      variant={current === value ? "default" : "outline"}
      onClick={() => onSelect(value)}
    >
      {children}
    </Button>
  )

  const sourcedRatings = Math.max(summary.ratings - summary.ratedWithoutSources, 0)
  const sourcedAnswers = Math.max(summary.answers - summary.answersWithoutSources, 0)

  return (
    <motion.div
      className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden bg-[#f4f6f8] dark:bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-5">
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl font-semibold tracking-tight text-[#111827] dark:text-gray-50">
              Retroalimentación
            </h2>
            <p className="mt-1 text-sm text-[#6b7280]">
              Cómo responden los asistentes: valoraciones, respuestas bajas y respuestas sin fuentes.
            </p>
          </div>
          <Button size="sm" variant="outline" className="shrink-0" onClick={handleExport}>
            Exportar a CSV
          </Button>
        </header>

        <div data-testid="feedback-stats" className="grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Stat
            label="Valoraciones"
            value={summary.ratings}
            hint="pulgar arriba o abajo"
            tone="bg-[#111827]"
            onClick={() => focusRatings("all", "all", null)}
          />
          <Stat
            label="Bajas"
            value={summary.low}
            hint={summary.ratings ? `${Math.round((summary.low / summary.ratings) * 100)}% de las valoraciones` : "sin valoraciones"}
            tone="bg-rose-500"
            onClick={() => focusRatings("negative", "all", null)}
          />
          <Stat
            label="Sin fuentes"
            value={summary.answersWithoutSources}
            hint={`${summary.ratedWithoutSources} también tienen valoración`}
            tone="bg-amber-500"
            onClick={() => focusRatings("all", "all", NO_SOURCES)}
          />
          <Stat
            label="Por revisar"
            value={summary.open}
            hint="valoraciones todavía abiertas"
            tone="bg-sky-500"
            onClick={() => focusRatings("all", "open", null)}
          />
        </div>

        <Section title="Desglose" detail="Positivas y bajas">
          <div className="space-y-2 px-4 py-3">
            <Meter label="Positivas" value={summary.positive} total={summary.ratings} barClass="bg-emerald-500" />
            <Meter label="Bajas" value={summary.low} total={summary.ratings} barClass="bg-rose-500" />
          </div>
        </Section>

        <details
          data-testid="feedback-desglose"
          className="min-w-0 max-w-full overflow-hidden rounded-xl border border-[#e7e9ee] bg-white dark:border-zinc-800 dark:bg-zinc-950 [&[open]>summary>svg]:rotate-180"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-2.5 text-sm font-medium text-[#111827] dark:text-gray-100 [&::-webkit-details-marker]:hidden">
            Ver desglose
            <ChevronDown className="h-4 w-4 shrink-0 text-[#9ca3af] transition-transform" />
          </summary>
          <div className="space-y-5 border-t border-[#eef0f3] px-4 py-4 dark:border-zinc-800">
            <div className="space-y-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#6b7280]">Fuentes en valoraciones</p>
              <Meter label="Con fuentes" value={sourcedRatings} total={summary.ratings} barClass="bg-sky-500" />
              <Meter label="Sin fuentes" value={summary.ratedWithoutSources} total={summary.ratings} barClass="bg-amber-500" />
            </div>
            <div className="space-y-2" data-testid="feedback-saved-bars">
              <p className="text-[11px] font-medium uppercase tracking-wide text-[#6b7280]">Respuestas guardadas</p>
              <Meter label="Con fuentes" value={sourcedAnswers} total={summary.answers} barClass="bg-sky-500" />
              <Meter label="Sin fuentes" value={summary.answersWithoutSources} total={summary.answers} barClass="bg-amber-500" />
            </div>

            <div>
              <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#6b7280]">
                Por asistente
              </p>
              {byAssistant.length === 0 ? (
                <p className="text-sm text-[#6b7280]">Todavía no hay valoraciones.</p>
              ) : (
                <div className="max-w-full overflow-x-auto rounded-lg border border-[#eef0f3] dark:border-zinc-800">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="h-9 text-[11px] uppercase tracking-wide">Asistente</TableHead>
                        <TableHead className="h-9 text-right text-[11px] uppercase tracking-wide">Valoraciones</TableHead>
                        <TableHead className="h-9 text-right text-[11px] uppercase tracking-wide">Bajas</TableHead>
                        <TableHead className="h-9 text-right text-[11px] uppercase tracking-wide">Sin fuentes</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {byAssistant.map((row) => (
                        <TableRow key={row.name}>
                          <TableCell className="py-2.5 font-medium">{row.name}</TableCell>
                          <TableCell className="py-2.5 text-right tabular-nums">{row.total}</TableCell>
                          <TableCell className="py-2.5 text-right tabular-nums">{row.low}</TableCell>
                          <TableCell className="py-2.5 text-right tabular-nums">{row.unsourced}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>

            {documentGroups.length > 0 && (
              <div data-testid="feedback-groups">
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-[#6b7280]">
                  Documentos citados en las valoraciones
                </p>
                <div className="flex flex-wrap gap-2">
                  {documentGroups.map(([title, count]) => (
                    <button
                      key={title}
                      type="button"
                      onClick={() => {
                        const next = documentFilter === title ? null : title
                        setDocumentFilter(next)
                        setRatingFilter("all")
                        setStatusFilter("all")
                        window.document.getElementById("valoraciones")?.scrollIntoView({
                          behavior: "smooth",
                          block: "start",
                        })
                      }}
                      className={cn(
                        "max-w-full truncate rounded-full border px-3 py-1 text-xs sm:max-w-xs",
                        documentFilter === title
                          ? "border-[#111827] bg-[#111827] text-white"
                          : "border-[#e7e9ee] bg-white text-[#374151] hover:bg-[#f8f9fb] dark:border-zinc-700 dark:bg-zinc-950 dark:text-gray-200"
                      )}
                      title={title}
                    >
                      {title} · {count}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </details>

        <Section
          id="bajas"
          title="Bajas abiertas"
          detail={loading ? undefined : `${openLowItems.length} por revisar`}
        >
          {loading ? (
            <p className="px-4 py-6 text-sm text-[#6b7280]">Cargando...</p>
          ) : openLowItems.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[#6b7280]">No hay valoraciones bajas abiertas.</p>
          ) : (
            <ul data-testid="feedback-open-lows" className="max-h-72 divide-y divide-[#eef0f3] overflow-auto dark:divide-zinc-800">
              {openLowItems.map((item) => {
                const key = item.id + item.userId
                const open = expanded === key
                return (
                  <li key={key}>
                    <button
                      type="button"
                      data-testid="feedback-open-low"
                      aria-expanded={open}
                      className="grid w-full min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left sm:grid-cols-[minmax(0,1fr)_auto_auto]"
                      onClick={() => setExpanded(open ? null : key)}
                    >
                      <span className="truncate text-sm font-medium text-[#111827] dark:text-gray-100">
                        {item.question ? clip(item.question, 120) : "Sin pregunta"}
                      </span>
                      <RatingBadge rating={item.rating} />
                      <span className="col-start-1 text-xs text-[#6b7280] sm:col-start-auto sm:justify-self-end sm:whitespace-nowrap">
                        {formatDate(item.timestamp)}
                      </span>
                    </button>
                    {open && (
                      <div className="bg-[#fafbfc] px-4 py-3 dark:bg-zinc-900">
                        <RatingBody
                          item={item}
                          busy={busyId === key}
                          onSend={send}
                          onDialog={setDialog}
                        />
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </Section>

        <Section
          id="sin-fuentes"
          title="Respuestas sin fuentes"
          detail={
            summary.answersWithoutSources
              ? `${summary.answersWithoutSources} en total · se listan las más recientes`
              : undefined
          }
        >
          {loading ? (
            <p className="px-4 py-6 text-sm text-[#6b7280]">Cargando...</p>
          ) : unsourced.length === 0 ? (
            <p className="px-4 py-6 text-sm text-[#6b7280]">Ninguna respuesta guardada está sin fuentes.</p>
          ) : (
            <div className="max-h-[22rem] max-w-full overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="h-9 w-8" />
                    <TableHead className="h-9 text-[11px] uppercase tracking-wide">Pregunta</TableHead>
                    <TableHead className="h-9 text-[11px] uppercase tracking-wide">Asistente</TableHead>
                    <TableHead className="h-9 text-[11px] uppercase tracking-wide">Valoración</TableHead>
                    <TableHead className="h-9 text-[11px] uppercase tracking-wide">Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {unsourced.map((row) => {
                    const key = `bare-${row.id}`
                    const open = expanded === key
                    const rated = ratingByMessage.get(row.id)
                    return (
                      <Fragment key={key}>
                        <TableRow
                          key={key}
                          className="cursor-pointer"
                          onClick={() => setExpanded(open ? null : key)}
                        >
                          <TableCell className="py-2.5">
                            <ChevronDown className={cn("h-4 w-4 text-[#9ca3af]", open && "rotate-180")} />
                          </TableCell>
                          <TableCell className="max-w-[18rem] py-2.5">
                            <p className="truncate font-medium">{row.question ? clip(row.question, 90) : "Sin pregunta"}</p>
                          </TableCell>
                          <TableCell className="py-2.5 text-[#4b5563]">{row.chatbotName}</TableCell>
                          <TableCell className="py-2.5">
                            {rated ? (
                              <RatingBadge rating={rated.rating} />
                            ) : (
                              <span className="text-xs text-[#9ca3af]">Sin valoración</span>
                            )}
                          </TableCell>
                          <TableCell className="whitespace-nowrap py-2.5 text-xs text-[#6b7280]">
                            {formatWhen(row.timestamp)}
                          </TableCell>
                        </TableRow>
                        {open && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={5} className="bg-[#fafbfc] py-3 dark:bg-zinc-900">
                              <p className="whitespace-pre-wrap text-sm">{row.response}</p>
                              {row.userEmail && (
                                <p className="mt-2 text-xs text-[#6b7280]">{row.userEmail}</p>
                              )}
                              {rated && (
                                <div className="mt-3">
                                  <RatingBody
                                    item={rated}
                                    busy={busyId === rated.id + rated.userId}
                                    onSend={send}
                                    onDialog={setDialog}
                                  />
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </Section>

        <Section
          id="valoraciones"
          title="Valoraciones"
          detail={loading ? undefined : `${visible.length} de ${items.length}`}
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-[#eef0f3] px-4 py-3 dark:border-zinc-800">
            <Toggle value="all" current={ratingFilter} onSelect={setRatingFilter}>Todas</Toggle>
            <Toggle value="negative" current={ratingFilter} onSelect={setRatingFilter}>Bajas</Toggle>
            <Toggle value="positive" current={ratingFilter} onSelect={setRatingFilter}>Positivas</Toggle>
            <span className="mx-1 h-6 border-l" />
            <Toggle value="open" current={statusFilter} onSelect={setStatusFilter}>Pendientes</Toggle>
            <Toggle value="resolved" current={statusFilter} onSelect={setStatusFilter}>Resueltas</Toggle>
            <Toggle value="all" current={statusFilter} onSelect={setStatusFilter}>Cualquier estado</Toggle>
          </div>
          {loading && <p className="px-4 py-6 text-sm text-[#6b7280]">Cargando...</p>}
          {!loading && visible.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-[#6b7280]">
              {items.length === 0
                ? "Todavía no hay valoraciones."
                : "No hay valoraciones con estos filtros."}
            </p>
          )}
          {visible.length > 0 && (
            <div className="max-h-[28rem] overflow-auto">
              <RatingTable
                rows={visible}
                expanded={expanded}
                setExpanded={setExpanded}
                busyId={busyId}
                onSend={send}
                onDialog={setDialog}
              />
            </div>
          )}
        </Section>
      </div>

      {dialog && (
        <TriageDialog
          key={dialog.item.id + dialog.action}
          item={dialog.item}
          action={dialog.action}
          onClose={() => setDialog(null)}
          onSubmit={async (extra) => {
            const ok = await send(dialog.item, dialog.action, extra)
            if (ok) setDialog(null)
          }}
        />
      )}
    </motion.div>
  )
}

function RatingBadge({ rating }: { rating: number }) {
  return (
    <Badge
      variant="secondary"
      className={rating === 1 ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}
    >
      {rating === 1 ? "Positiva" : "Baja"}
    </Badge>
  )
}

function RatingTable({
  rows,
  expanded,
  setExpanded,
  busyId,
  onSend,
  onDialog,
}: {
  rows: Evaluation[]
  expanded: string | null
  setExpanded: (id: string | null) => void
  busyId: string | null
  onSend: (
    item: Evaluation,
    action: TriageAction,
    extra?: { fileId?: string; note?: string; notifyUser?: boolean; userMessage?: string }
  ) => Promise<boolean>
  onDialog: (dialog: {
    item: Evaluation
    action: "outdated_document" | "prompt_note" | "request_document"
  }) => void
}) {
  return (
    <>
    <div className="md:hidden">
      {rows.map((item) => {
        const key = item.id + item.userId
        const open = expanded === key
        return (
          <div key={key} className="border-b border-[#eef0f3] last:border-b-0 dark:border-zinc-800">
            <button
              type="button"
              className="flex w-full items-start gap-3 px-4 py-3 text-left"
              onClick={() => setExpanded(open ? null : key)}
            >
              <ChevronDown className={cn("mt-0.5 h-4 w-4 shrink-0 text-[#9ca3af]", open && "rotate-180")} />
              <span className="min-w-0 flex-1">
                <span className="block break-words text-sm font-medium">
                  {item.question ? clip(item.question, 140) : "Sin pregunta"}
                </span>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#6b7280]">
                  <RatingBadge rating={item.rating} />
                  <span>{item.sources.length === 0 ? NO_SOURCES : `${item.sources.length} fuentes`}</span>
                  <span>{item.triage.status === "resolved" ? "Resuelta" : "Pendiente"}</span>
                  <span>{formatWhen(item.timestamp)}</span>
                </span>
              </span>
            </button>
            {open && (
              <div className="bg-[#fafbfc] px-4 py-3 dark:bg-zinc-900">
                <RatingBody
                  item={item}
                  busy={busyId === key}
                  onSend={onSend}
                  onDialog={onDialog}
                />
              </div>
            )}
          </div>
        )
      })}
    </div>
    <div className="hidden max-w-full overflow-x-auto md:block">
    <Table>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-9 w-8" />
          <TableHead className="h-9 text-[11px] uppercase tracking-wide">Pregunta</TableHead>
          <TableHead className="h-9 text-[11px] uppercase tracking-wide">Valoración</TableHead>
          <TableHead className="h-9 text-[11px] uppercase tracking-wide">Fuentes</TableHead>
          <TableHead className="h-9 text-[11px] uppercase tracking-wide">Estado</TableHead>
          <TableHead className="h-9 text-[11px] uppercase tracking-wide">Fecha</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((item) => {
          const key = item.id + item.userId
          const open = expanded === key
          return (
            <Fragment key={key}>
              <TableRow
                data-testid="feedback-item"
                className="cursor-pointer"
                onClick={() => setExpanded(open ? null : key)}
              >
                <TableCell className="py-2.5">
                  <ChevronDown className={cn("h-4 w-4 text-[#9ca3af]", open && "rotate-180")} />
                </TableCell>
                <TableCell className="max-w-[20rem] py-2.5">
                  <p className="truncate font-medium">{item.question ? clip(item.question, 96) : "Sin pregunta"}</p>
                  <p className="truncate text-xs text-[#6b7280]">
                    {item.chatbotName}
                    {item.comment ? ` · ${clip(item.comment, 60)}` : ""}
                  </p>
                </TableCell>
                <TableCell className="py-2.5">
                  <RatingBadge rating={item.rating} />
                </TableCell>
                <TableCell className="py-2.5 text-xs text-[#4b5563]">
                  {item.sources.length === 0 ? NO_SOURCES : item.sources.length}
                </TableCell>
                <TableCell className="py-2.5 text-xs">
                  {item.triage.status === "resolved" ? "Resuelta" : "Pendiente"}
                </TableCell>
                <TableCell className="whitespace-nowrap py-2.5 text-xs text-[#6b7280]">
                  {formatWhen(item.timestamp)}
                </TableCell>
              </TableRow>
              {open && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="bg-[#fafbfc] py-3 dark:bg-zinc-900">
                    <RatingBody
                      item={item}
                      busy={busyId === key}
                      onSend={onSend}
                      onDialog={onDialog}
                    />
                  </TableCell>
                </TableRow>
              )}
            </Fragment>
          )
        })}
      </TableBody>
    </Table>
    </div>
    </>
  )
}

function RatingBody({
  item,
  busy,
  onSend,
  onDialog,
}: {
  item: Evaluation
  busy: boolean
  onSend: (
    item: Evaluation,
    action: TriageAction,
    extra?: { fileId?: string; note?: string; notifyUser?: boolean; userMessage?: string }
  ) => Promise<boolean>
  onDialog: (dialog: {
    item: Evaluation
    action: "outdated_document" | "prompt_note" | "request_document"
  }) => void
}) {
  const resolved = item.triage.status === "resolved"
  return (
    <div className="space-y-3" onClick={(event) => event.stopPropagation()}>
      <p className="text-xs text-[#6b7280]">
        {item.userEmail} · {item.chatbotName}
      </p>
      <p className="whitespace-pre-wrap text-sm">{item.response}</p>
      {item.comment && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/30">
          <span className="font-medium">Comentario: </span>
          {item.comment}
        </p>
      )}
      {item.triage.note && <p className="text-xs text-[#6b7280]">Nota: {item.triage.note}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs font-medium text-[#6b7280]">Fuentes:</span>
        {item.sources.length === 0 ? (
          <span className="text-xs text-[#9ca3af]">ninguna</span>
        ) : (
          item.sources.map((source, index) => (
            <Badge key={index} variant="outline" className="max-w-xs truncate text-xs" title={source.title}>
              {source.title}
            </Badge>
          ))
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin" />}
        {!resolved && (
          <>
            {item.sources.some((source) => source.fileId) && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onDialog({ item, action: "outdated_document" })}>
                <Flag className="mr-1 h-3.5 w-3.5" />
                Marcar documento desactualizado
              </Button>
            )}
            <Button size="sm" variant="outline" disabled={busy} onClick={() => onDialog({ item, action: "prompt_note" })}>
              <NotebookPen className="mr-1 h-3.5 w-3.5" />
              Agregar nota al asistente
            </Button>
            {item.triage.action !== "request_document" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onDialog({ item, action: "request_document" })}>
                <FilePlus2 className="mr-1 h-3.5 w-3.5" />
                Pedir documento
              </Button>
            )}
            {item.triage.action === "request_document" && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => onSend(item, "resolve")}>
                <Check className="mr-1 h-3.5 w-3.5" />
                Marcar como resuelta
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSend(item, "dismiss")}>
              <X className="mr-1 h-3.5 w-3.5" />
              Descartar
            </Button>
          </>
        )}
        {resolved && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onSend(item, "reopen")}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" />
            Reabrir
          </Button>
        )}
      </div>
    </div>
  )
}

const DIALOG_COPY = {
  outdated_document: {
    title: "Marcar documento como desactualizado",
    description:
      "El documento seguirá usándose, pero las respuestas que lo citen mostrarán una advertencia.",
    noteLabel: "Nota (opcional): qué lo reemplaza o qué cambió",
    submit: "Marcar",
  },
  prompt_note: {
    title: "Agregar nota al asistente",
    description:
      "Se añade a las instrucciones del asistente (máximo 10 notas). Puedes editarla o quitarla en Asistente.",
    noteLabel: "Indicación para el asistente",
    submit: "Agregar nota",
  },
  request_document: {
    title: "Pedir documento",
    description: "Queda anotado como pendiente hasta que lo marques como resuelto.",
    noteLabel: "Qué documento falta",
    submit: "Pedir",
  },
} as const

function TriageDialog({
  item,
  action,
  onClose,
  onSubmit,
}: {
  item: Evaluation
  action: "outdated_document" | "prompt_note" | "request_document"
  onClose: () => void
  onSubmit: (extra: {
    fileId?: string
    note?: string
    notifyUser?: boolean
    userMessage?: string
  }) => Promise<void>
}) {
  const copy = DIALOG_COPY[action]
  const documents = item.sources.filter(
    (source): source is { title: string; fileId: string } => Boolean(source.fileId)
  )
  const unique = documents.filter(
    (doc, index) => documents.findIndex((candidate) => candidate.fileId === doc.fileId) === index
  )
  const [fileId, setFileId] = useState(unique[0]?.fileId ?? "")
  const [note, setNote] = useState("")
  const [notify, setNotify] = useState(false)
  const [userMessage, setUserMessage] = useState("")
  const [saving, setSaving] = useState(false)

  const noteRequired = action !== "outdated_document"
  const canSubmit =
    (!noteRequired || note.trim().length > 0) &&
    (action !== "outdated_document" || Boolean(fileId)) &&
    (!notify || userMessage.trim().length > 0)

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {action === "outdated_document" && (
            <div className="space-y-2">
              <Label>Documento</Label>
              {unique.map((doc) => (
                <label key={doc.fileId} className="flex items-start gap-2 text-sm">
                  <input
                    type="radio"
                    name="document"
                    checked={fileId === doc.fileId}
                    onChange={() => setFileId(doc.fileId)}
                    className="mt-1"
                  />
                  {doc.title}
                </label>
              ))}
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="triage-note">{copy.noteLabel}</Label>
            <Textarea
              id="triage-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={300}
            />
          </div>
          {item.userEmail && (
            <div className="space-y-2 rounded border p-3">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={notify}
                  onCheckedChange={(checked) => setNotify(checked === true)}
                />
                Avisar a {item.userEmail} por correo
              </label>
              {notify && (
                <Textarea
                  value={userMessage}
                  onChange={(event) => setUserMessage(event.target.value)}
                  maxLength={500}
                  placeholder="Mensaje para el usuario"
                  aria-label="Mensaje para el usuario"
                />
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!canSubmit || saving}
            onClick={async () => {
              setSaving(true)
              await onSubmit({
                ...(action === "outdated_document" ? { fileId } : {}),
                note: note.trim() || undefined,
                ...(notify ? { notifyUser: true, userMessage: userMessage.trim() } : {}),
              })
              setSaving(false)
            }}
          >
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {copy.submit}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

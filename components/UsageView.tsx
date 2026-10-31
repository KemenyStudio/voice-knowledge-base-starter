"use client"

import { useEffect, useState, type ReactNode } from "react"
import { motion } from "framer-motion"

import { Button } from "@/components/ui/button"
import type { SummaryKind, UsagePayload } from "@/lib/usage/metrics"

const numberFormat = new Intl.NumberFormat("es-MX")

function formatCount(value: number): string {
  return numberFormat.format(value)
}

function formatFigure(kind: SummaryKind, value: number): string {
  switch (kind) {
    case "rate": {
      const percent = value <= 1 ? value * 100 : value
      return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(percent)}%`
    }
    case "score":
      return new Intl.NumberFormat("es-MX", { maximumFractionDigits: 2 }).format(value)
    case "count":
      return formatCount(value)
    default: {
      const unreachable: never = kind
      return unreachable
    }
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${formatCount(Math.round(ms))} ms`
  const seconds = ms / 1000
  return `${new Intl.NumberFormat("es-MX", { maximumFractionDigits: 1 }).format(seconds)} s`
}

function Metric({
  value,
  label,
  hint,
}: {
  value: string
  label: string
  hint?: string
}) {
  return (
    <div className="min-w-0 rounded-xl border border-[#e7e9ee] bg-white px-3 py-3 dark:border-zinc-800 dark:bg-zinc-950 sm:px-4">
      <p className="text-2xl font-semibold leading-none tabular-nums text-[#111827] dark:text-gray-50 sm:text-[28px]">
        {value}
      </p>
      <p className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-[#6b7280]">
        {label}
      </p>
      {hint ? <p className="mt-1 text-xs text-[#6b7280]">{hint}</p> : null}
    </div>
  )
}

function Block({
  title,
  detail,
  children,
  action,
}: {
  title: string
  detail?: string
  children: ReactNode
  action?: ReactNode
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-[#e7e9ee] bg-white dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[#eef0f3] px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-[#111827] dark:text-gray-100">{title}</h2>
        {detail ? <p className="text-xs text-[#6b7280]">{detail}</p> : null}
      </div>
      <div className="px-3 py-3 sm:px-4">{children}</div>
      {action ? (
        <div className="border-t border-[#eef0f3] px-4 py-3 dark:border-zinc-800">{action}</div>
      ) : null}
    </section>
  )
}

function EmptyLine({ children }: { children: string }) {
  return <p className="text-sm text-[#6b7280]">{children}</p>
}

export default function UsageView({
  chatbotId,
  onOpenHistory,
  onOpenFeedback,
}: {
  chatbotId: string
  onOpenHistory?: () => void
  onOpenFeedback?: () => void
}) {
  const [data, setData] = useState<UsagePayload | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch(`/api/usage?chatbotId=${chatbotId}`)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || "No se pudo cargar el uso.")
        if (!cancelled) setData(payload as UsagePayload)
      } catch (loadError) {
        if (!cancelled) setError((loadError as Error).message)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [chatbotId])

  const tools = data?.telemetry.tools
  const calls = data?.telemetry.modelCalls
  const retrieval = data?.telemetry.retrieval

  return (
    <motion.div
      className="flex h-full min-h-0 w-full min-w-0 max-w-full flex-col overflow-hidden bg-[#f4f6f8] dark:bg-black"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
    >
      <div className="min-h-0 min-w-0 flex-1 space-y-4 overflow-x-hidden overflow-y-auto px-3 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-5">
        <header>
          <h1 className="text-xl font-semibold tracking-tight text-[#111827] dark:text-gray-50">
            Uso del asistente
          </h1>
          <p className="mt-1 text-sm text-[#6b7280]">
            Conteos, evaluaciones y lo que ya queda registrado. Las preguntas están en Historial.
          </p>
        </header>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {!data && !error ? <p className="text-sm text-[#6b7280]">Cargando…</p> : null}

        {data ? (
          <>
            <Block
              title="Uso"
              detail="Mensajes guardados"
              action={
                onOpenHistory ? (
                  <Button type="button" size="sm" variant="outline" onClick={onOpenHistory}>
                    Ver historial
                  </Button>
                ) : null
              }
            >
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Metric value={formatCount(data.usage.questions)} label="Preguntas" />
                <Metric value={formatCount(data.usage.questions7d)} label="7 días" hint="preguntas" />
                <Metric value={formatCount(data.usage.questions30d)} label="30 días" hint="preguntas" />
                <Metric value={formatCount(data.usage.answers)} label="Respuestas" />
                <Metric value={formatCount(data.usage.conversations)} label="Conversaciones" />
                <Metric value={formatCount(data.usage.people)} label="Personas" hint="quien preguntó" />
              </div>
            </Block>

            <Block
              title="Evaluaciones"
              detail={data.evaluations.truncated ? "Primeras 5.000 votaciones" : "Votos del equipo"}
            >
              {data.evaluations.sets.length === 0 ? (
                <EmptyLine>No hay evaluaciones guardadas para este asistente.</EmptyLine>
              ) : (
                <div className="space-y-4">
                  {data.evaluations.sets.map((set) => (
                    <div key={set.evaluationSet} className="min-w-0">
                      <p className="mb-2 text-xs font-medium text-[#111827] dark:text-gray-100">
                        {set.label}
                      </p>
                      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                        <Metric value={formatCount(set.pass)} label="A favor" />
                        <Metric value={formatCount(set.fail)} label="En contra" />
                        {set.blank > 0 ? (
                          <Metric value={formatCount(set.blank)} label="Sin voto" />
                        ) : null}
                        {set.summary.map((figure) => (
                          <Metric
                            key={figure.key}
                            value={formatFigure(figure.kind, figure.value)}
                            label={figure.label}
                          />
                        ))}
                      </div>
                      {set.summary.length === 0 ? (
                        <p className="mt-2 text-xs text-[#6b7280]">
                          Sin resumen numérico de la corrida.
                        </p>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </Block>

            <Block
              title="Calificaciones"
              detail="Pulgar en las respuestas"
              action={
                onOpenFeedback ? (
                  <Button type="button" size="sm" variant="outline" onClick={onOpenFeedback}>
                    Ver retroalimentación
                  </Button>
                ) : null
              }
            >
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                <Metric value={formatCount(data.ratings.negative)} label="Bajas" />
                <Metric value={formatCount(data.ratings.positive)} label="Altas" />
                <Metric value={formatCount(data.ratings.open)} label="Por revisar" />
              </div>
            </Block>

            <Block title="Sin fuentes" detail="Respuestas guardadas sin citas">
              <div className="grid grid-cols-2 gap-3">
                <Metric
                  value={formatCount(data.unsourcedAnswers)}
                  label="Sin fuentes"
                  hint="sin aclaración ni aviso de biblioteca vacía"
                />
              </div>
            </Block>

            <Block title="Latencia">
              <div className="space-y-3">
                <EmptyLine>No se guarda el tiempo de las respuestas.</EmptyLine>
                {tools && tools.runs > 0 && tools.avgMs != null && tools.maxMs != null ? (
                  <div className="grid grid-cols-2 gap-3">
                    <Metric
                      value={formatDuration(tools.avgMs)}
                      label="Herramientas"
                      hint="promedio"
                    />
                    <Metric
                      value={formatDuration(tools.maxMs)}
                      label="Máxima"
                      hint={`${formatCount(tools.runs)} corridas`}
                    />
                  </div>
                ) : tools && tools.runs > 0 ? (
                  <EmptyLine>Hay corridas de herramientas, pero no traen duración.</EmptyLine>
                ) : (
                  <EmptyLine>No hay duración de herramientas registrada.</EmptyLine>
                )}
              </div>
            </Block>

            <Block title="Errores">
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Metric
                    value={formatCount(tools?.errors ?? 0)}
                    label="Herramientas"
                    hint="corridas con error"
                  />
                  <Metric
                    value={formatCount(retrieval?.indexFailed ?? 0)}
                    label="Índice"
                    hint="documentos con indexación fallida"
                  />
                </div>
                <EmptyLine>No se guardan los errores del modelo.</EmptyLine>
              </div>
            </Block>

            <Block title="Llamadas al modelo" detail="Por el id guardado de la respuesta">
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                <Metric value={formatCount(calls?.withModel ?? 0)} label="Con modelo" />
                <Metric value={formatCount(calls?.withoutModel ?? 0)} label="Sin modelo" />
                {(calls?.other ?? 0) > 0 ? (
                  <Metric
                    value={formatCount(calls?.other ?? 0)}
                    label="Id anterior"
                    hint="sin prefijo resp_ ni local_"
                  />
                ) : null}
              </div>
            </Block>

            <Block title="Recuperación" detail="Citas e índice guardados">
              <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                <Metric value={formatCount(retrieval?.withSources ?? 0)} label="Con citas" />
                <Metric value={formatCount(retrieval?.citationCount ?? 0)} label="Citas" />
                <Metric value={formatCount(retrieval?.researchAnswers ?? 0)} label="A fondo" />
                <Metric
                  value={formatCount(retrieval?.indexReady ?? 0)}
                  label="Listos"
                  hint={
                    retrieval
                      ? `de ${formatCount(retrieval.documents)} documentos`
                      : undefined
                  }
                />
                <Metric
                  value={formatCount(retrieval?.uncitedDocuments ?? 0)}
                  label="Sin citar"
                  hint="documentos que ninguna respuesta cita"
                />
              </div>
            </Block>
          </>
        ) : null}
      </div>
    </motion.div>
  )
}

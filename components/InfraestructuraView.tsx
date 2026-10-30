"use client"

import { useEffect, useState } from "react"
import {
  Cloud,
  Database,
  Mail,
  Network,
  Sparkles,
  Waypoints,
  type LucideIcon,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import type { InfraConnection, InfraConnectionStatus, InfraStatus } from "@/lib/infra/status"

type ToneId = "sky" | "teal" | "violet" | "amber" | "rose" | "zinc" | "emerald" | "indigo"

interface Tone {
  wash: string
  border: string
  node: string
  line: string
}

const FLOWS: Array<{
  title: string
  caption: string
  steps: string[]
  tone: ToneId
}> = [
  {
    title: "Pregunta en el chat",
    caption:
      "Una pregunta normal busca solo en la biblioteca. Investigar a fondo parte la pregunta, busca en el mismo índice y redacta después.",
    steps: ["Pregunta", "App", "file_search", "Modelo", "Respuesta citada"],
    tone: "sky",
  },
  {
    title: "Fuente oficial más reciente",
    caption: "Otra llamada, aparte de la biblioteca. Los resultados se marcan como web.",
    steps: ["Pregunta", "App", "web_search", "Nota web"],
    tone: "teal",
  },
  {
    title: "Llamada de voz",
    caption:
      "La app entrega un secreto corto. La clave de OpenAI se queda en el servidor. buscar_biblioteca usa el mismo índice.",
    steps: ["Voz", "App", "Realtime", "buscar_biblioteca", "Respuesta hablada"],
    tone: "violet",
  },
  {
    title: "Documento a la biblioteca",
    caption:
      "El modelo propone tipo, audiencia, fuente y contexto. El archivo queda en el bucket privado y en el vector store del asistente.",
    steps: ["Archivo", "Storage", "Ficha", "Índice"],
    tone: "amber",
  },
  {
    title: "Agente externo",
    caption: "Entra con su clave a /api/mcp, lee el equipo de esa clave y recibe pasajes. No redacta la respuesta.",
    steps: ["Agente", "/api/mcp", "Equipo", "Pasajes"],
    tone: "rose",
  },
]

function toneOf(id: ToneId): Tone {
  switch (id) {
    case "sky":
      return {
        wash: "bg-sky-500/[0.08] dark:bg-sky-400/[0.1]",
        border: "border-sky-600/20 dark:border-sky-300/25",
        node: "bg-sky-600 text-white dark:bg-sky-400 dark:text-sky-950",
        line: "bg-sky-600/70 dark:bg-sky-300/80",
      }
    case "teal":
      return {
        wash: "bg-teal-500/[0.08] dark:bg-teal-400/[0.1]",
        border: "border-teal-600/20 dark:border-teal-300/25",
        node: "bg-teal-600 text-white dark:bg-teal-300 dark:text-teal-950",
        line: "bg-teal-600/70 dark:bg-teal-300/80",
      }
    case "violet":
      return {
        wash: "bg-violet-500/[0.08] dark:bg-violet-400/[0.1]",
        border: "border-violet-600/20 dark:border-violet-300/25",
        node: "bg-violet-600 text-white dark:bg-violet-300 dark:text-violet-950",
        line: "bg-violet-600/70 dark:bg-violet-300/80",
      }
    case "amber":
      return {
        wash: "bg-amber-500/[0.1] dark:bg-amber-400/[0.1]",
        border: "border-amber-600/25 dark:border-amber-300/25",
        node: "bg-amber-600 text-white dark:bg-amber-300 dark:text-amber-950",
        line: "bg-amber-600/70 dark:bg-amber-300/80",
      }
    case "rose":
      return {
        wash: "bg-rose-500/[0.08] dark:bg-rose-400/[0.1]",
        border: "border-rose-600/20 dark:border-rose-300/25",
        node: "bg-rose-600 text-white dark:bg-rose-300 dark:text-rose-950",
        line: "bg-rose-600/70 dark:bg-rose-300/80",
      }
    case "zinc":
      return {
        wash: "bg-zinc-500/[0.06] dark:bg-white/[0.04]",
        border: "border-zinc-400/40 dark:border-white/15",
        node: "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900",
        line: "bg-zinc-500/70 dark:bg-zinc-300/70",
      }
    case "emerald":
      return {
        wash: "bg-emerald-500/[0.08] dark:bg-emerald-400/[0.1]",
        border: "border-emerald-600/20 dark:border-emerald-300/25",
        node: "bg-emerald-600 text-white dark:bg-emerald-300 dark:text-emerald-950",
        line: "bg-emerald-600/70 dark:bg-emerald-300/80",
      }
    case "indigo":
      return {
        wash: "bg-indigo-500/[0.08] dark:bg-indigo-400/[0.1]",
        border: "border-indigo-600/20 dark:border-indigo-300/25",
        node: "bg-indigo-600 text-white dark:bg-indigo-300 dark:text-indigo-950",
        line: "bg-indigo-600/70 dark:bg-indigo-300/80",
      }
    default: {
      const unreachable: never = id
      return unreachable
    }
  }
}

function connectionTone(id: string): ToneId {
  switch (id) {
    case "vercel":
      return "zinc"
    case "supabase":
      return "emerald"
    case "openai":
      return "indigo"
    case "resend":
      return "rose"
    case "mcp":
      return "violet"
    default:
      return "zinc"
  }
}

function connectionIcon(id: string): LucideIcon {
  switch (id) {
    case "vercel":
      return Cloud
    case "supabase":
      return Database
    case "openai":
      return Sparkles
    case "resend":
      return Mail
    case "mcp":
      return Waypoints
    default:
      return Network
  }
}

function statusClass(status: InfraConnectionStatus): string {
  switch (status) {
    case "present":
      return "bg-emerald-500/15 text-emerald-900 ring-emerald-600/25 dark:text-emerald-200 dark:ring-emerald-300/30"
    case "missing":
      return "bg-amber-500/15 text-amber-950 ring-amber-600/25 dark:text-amber-100 dark:ring-amber-300/30"
    case "misconfigured":
      return "bg-red-500/15 text-red-900 ring-red-600/25 dark:text-red-200 dark:ring-red-300/30"
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

function statusDot(status: InfraConnectionStatus): string {
  switch (status) {
    case "present":
      return "bg-emerald-600 dark:bg-emerald-300"
    case "missing":
      return "bg-amber-600 dark:bg-amber-300"
    case "misconfigured":
      return "bg-red-600 dark:bg-red-300"
    default: {
      const unreachable: never = status
      return unreachable
    }
  }
}

function StepNode({ index, tone }: { index: number; tone: Tone }) {
  return (
    <span
      className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold shadow-sm ${tone.node}`}
    >
      {index + 1}
    </span>
  )
}

function FlowDiagram({
  title,
  caption,
  steps,
  tone: toneId,
}: {
  title: string
  caption: string
  steps: string[]
  tone: ToneId
}) {
  const tone = toneOf(toneId)
  return (
    <figure className={`min-w-0 space-y-4 rounded-xl border p-4 ${tone.wash} ${tone.border}`}>
      <figcaption className="space-y-1">
        <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">{title}</h3>
        <p className="max-w-3xl text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{caption}</p>
      </figcaption>
      <ol className="flex flex-col sm:hidden">
        {steps.map((step, index) => (
          <li key={step} className="flex gap-3">
            <div className="flex flex-col items-center">
              <StepNode index={index} tone={tone} />
              {index < steps.length - 1 && <span className={`my-1 w-0.5 flex-1 ${tone.line}`} />}
            </div>
            <span className="pb-4 pt-1 text-sm font-medium leading-snug text-zinc-950 dark:text-zinc-50">
              {step}
            </span>
          </li>
        ))}
      </ol>
      <ol
        className="hidden sm:grid"
        style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}
      >
        {steps.map((step, index) => (
          <li key={step} className="relative flex min-w-0 flex-col items-center text-center">
            {index < steps.length - 1 && (
              <span
                aria-hidden
                className={`absolute left-[calc(50%+0.875rem)] right-[calc(-50%+0.875rem)] top-[0.8rem] h-0.5 ${tone.line}`}
              />
            )}
            <StepNode index={index} tone={tone} />
            <span className="mt-2 px-1 text-xs font-medium leading-snug text-zinc-950 dark:text-zinc-50">
              {step}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  )
}

function ConnectionCard({ connection }: { connection: InfraConnection }) {
  const tone = toneOf(connectionTone(connection.id))
  const Icon = connectionIcon(connection.id)
  return (
    <article className={`min-w-0 rounded-xl border p-4 ${tone.wash} ${tone.border}`}>
      <div className="flex items-start gap-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm ${tone.node}`}
          aria-hidden
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
                {connection.name}
              </h3>
              <p className="text-xs text-zinc-600 dark:text-zinc-400">{connection.purpose}</p>
            </div>
            <span
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ${statusClass(connection.status)}`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${statusDot(connection.status)}`} />
              {connection.statusLabel}
            </span>
          </div>
          <ul className="mt-3 space-y-1.5">
            {connection.lines.map((line) => (
              <li
                key={line}
                className="flex gap-2 text-xs leading-relaxed text-zinc-800 dark:text-zinc-200"
              >
                <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${tone.line}`} />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </article>
  )
}

export function InfraestructuraScreen({
  data,
  error,
}: {
  data: InfraStatus | null
  error: string | null
}) {
  return (
    <div
      data-testid="infra-page"
      className="flex h-full min-h-0 w-full max-w-full flex-col overflow-hidden bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-lg dark:bg-black sm:p-4"
    >
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-3 text-xl font-bold sm:text-2xl">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-600 text-white shadow-sm dark:bg-sky-400 dark:text-sky-950">
              <Network className="h-5 w-5" />
            </span>
            Infraestructura
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Servicios que esta instancia usa y si la clave está presente.
          </p>
        </CardHeader>
        <CardContent className="min-h-0 flex-1 space-y-8 overflow-auto">
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Flujos</h2>
            <div className="grid gap-4">
              {FLOWS.map((flow) => (
                <FlowDiagram key={flow.title} {...flow} />
              ))}
            </div>
          </section>
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Conexiones</h2>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {!data && !error && <p className="text-sm text-muted-foreground">Cargando…</p>}
            {data && (
              <div className="grid gap-4 md:grid-cols-2">
                {data.connections.map((connection) => (
                  <div
                    key={connection.id}
                    className={connection.id === "openai" ? "md:col-span-2" : undefined}
                  >
                    <ConnectionCard connection={connection} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </CardContent>
      </Card>
    </div>
  )
}

export default function InfraestructuraView({ chatbotId }: { chatbotId: string }) {
  const [data, setData] = useState<InfraStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const response = await fetch(`/api/infra?chatbotId=${chatbotId}`)
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(payload.error || "No se pudo cargar la infraestructura.")
        if (!cancelled) setData(payload as InfraStatus)
      } catch (loadError) {
        if (!cancelled) setError((loadError as Error).message)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [chatbotId])

  return <InfraestructuraScreen data={data} error={error} />
}

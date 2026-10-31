"use client"

import { Check, Loader2 } from "lucide-react"

export interface ResearchStep {
  id?: number
  label: string
  sources: number
  status?: "searching" | "done"
}

/** The searches of an "Investigar a fondo" answer, live or finished. */
export function ResearchSteps({
  steps,
  writing = false,
  finished = false,
}: {
  steps: ResearchStep[]
  /** All searches are done and the answer is being written. */
  writing?: boolean
  finished?: boolean
}) {
  if (steps.length === 0) return null
  const total = steps.reduce((sum, s) => sum + s.sources, 0)
  return (
    <div
      className="mb-3 rounded-md border border-green-200 bg-white/60 p-3 text-sm dark:border-green-800 dark:bg-black/20"
      data-testid="research-steps"
    >
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-green-800 dark:text-green-200">
        {finished ? "Cómo investigué" : "Investigando a fondo"}
      </p>
      <ul className="space-y-1">
        {steps.map((step, index) => {
          const done = finished || step.status === "done"
          return (
            <li key={step.id ?? index} className="flex items-start gap-2">
              {done ? (
                <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-green-600" aria-label="Hecho" />
              ) : (
                <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin" aria-label="En curso" />
              )}
              <span className="min-w-0">
                {step.label}
                {done && (
                  <span className="ml-1 text-xs text-gray-500">
                    · {step.sources} {step.sources === 1 ? "documento" : "documentos"}
                  </span>
                )}
              </span>
            </li>
          )
        })}
        {!finished && (
          <li className="flex items-start gap-2 text-gray-600 dark:text-gray-300">
            {writing ? (
              <>
                <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin" />
                <span>Redactando la respuesta con {total} fuentes…</span>
              </>
            ) : null}
          </li>
        )}
      </ul>
    </div>
  )
}

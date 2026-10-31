"use client"

import { useEffect, useState } from "react"
import { Check, Circle, Rocket } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { OnboardingStep } from "@/lib/onboarding"

type StepId = OnboardingStep["id"]

const COPY: Record<StepId, { title: string; hint: string; action: string }> = {
  assistant: {
    title: "Crea un asistente",
    hint: "Cada asistente tiene su propia biblioteca de documentos.",
    action: "Crear asistente",
  },
  documents: {
    title: "Sube los primeros documentos",
    hint: "El asistente solo responde con lo que hay en su biblioteca.",
    action: "Ir a la biblioteca",
  },
  teammate: {
    title: "Invita a un compañero",
    hint: "Los miembros pueden preguntar; los administradores gestionan documentos.",
    action: "Invitar",
  },
  question: {
    title: "Haz una primera pregunta",
    hint: "Comprueba que las respuestas citan tus documentos.",
    action: "Abrir el chat",
  },
}

/** First-steps checklist for team admins. Hides itself once everything is done or dismissed. */
export default function OnboardingChecklist({
  teamId,
  refreshKey,
  onAction,
}: {
  teamId: string
  refreshKey: number
  onAction: (step: StepId) => void
}) {
  const storageKey = `onboarding-dismissed:${teamId}`
  const [steps, setSteps] = useState<OnboardingStep[] | null>(null)
  const [dismissed, setDismissed] = useState(true)

  useEffect(() => {
    setDismissed(localStorage.getItem(storageKey) === "1")
  }, [storageKey])

  useEffect(() => {
    let cancelled = false
    fetch(`/api/teams/${teamId}/onboarding`, { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setSteps(data.steps)
      })
      .catch((error) => console.error("Error loading onboarding:", error))
    return () => {
      cancelled = true
    }
  }, [teamId, refreshKey])

  if (!steps || dismissed || steps.every((s) => s.done)) return null

  const done = steps.filter((s) => s.done).length

  return (
    <Card className="border-blue-200 shadow-lg dark:bg-black" data-testid="onboarding">
      <CardHeader className="flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-blue-500" />
            Primeros pasos ({done} de {steps.length})
          </CardTitle>
          <CardDescription>Deja el equipo listo en cuatro pasos.</CardDescription>
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            localStorage.setItem(storageKey, "1")
            setDismissed(true)
          }}
        >
          Ocultar
        </Button>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {steps.map((step) => {
            const copy = COPY[step.id]
            return (
              <li key={step.id} className="flex items-start gap-3">
                {step.done ? (
                  <Check className="mt-0.5 h-5 w-5 flex-shrink-0 text-green-600" aria-label="Hecho" />
                ) : (
                  <Circle className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-300" aria-label="Pendiente" />
                )}
                <div className="min-w-0 flex-1">
                  <p className={step.done ? "text-sm text-gray-500 line-through" : "text-sm font-medium"}>
                    {copy.title}
                  </p>
                  {!step.done && <p className="text-xs text-muted-foreground">{copy.hint}</p>}
                </div>
                {!step.done && (
                  <Button size="sm" variant="outline" onClick={() => onAction(step.id)}>
                    {copy.action}
                  </Button>
                )}
              </li>
            )
          })}
        </ol>
      </CardContent>
    </Card>
  )
}

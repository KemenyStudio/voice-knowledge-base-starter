"use client"

import { useCallback, useEffect, useState } from "react"
import { BellRing, X } from "lucide-react"

import { Button } from "@/components/ui/button"

export interface ChangeAlert {
  id: string
  publishedAt: string | null
  newFile: { id: string; name: string }
  oldFile: { id: string; name: string }
}

/**
 * Documents that appeared in the user's answers and were replaced by a newer one.
 * The e-mail opt-in lives in Ajustes and is stored on the user.
 */
export function ChangeAlerts({
  chatbotId,
  onCompare,
}: {
  chatbotId: string
  onCompare: (alert: ChangeAlert) => void
}) {
  const [alerts, setAlerts] = useState<ChangeAlert[]>([])

  const load = useCallback(() => {
    fetch(`/api/alerts?chatbotId=${chatbotId}`)
      .then((res) => (res.ok ? res.json() : { alerts: [] }))
      .then((data) => setAlerts(data.alerts ?? []))
      .catch(() => setAlerts([]))
  }, [chatbotId])

  useEffect(load, [load])

  const dismiss = async (id: string) => {
    setAlerts((prev) => prev.filter((a) => a.id !== id))
    await fetch("/api/alerts/seen", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatbotId, alertId: id }),
    }).catch(() => undefined)
  }

  if (alerts.length === 0) return null

  return (
    <div className="mb-4 space-y-2" data-testid="change-alerts">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
          data-testid="change-alert"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex min-w-0 items-start gap-2">
              <BellRing className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p className="min-w-0 break-words">
                Un documento que apareció en tus respuestas fue reemplazado:{" "}
                <strong>{alert.newFile.name}</strong> sustituye a{" "}
                <strong>{alert.oldFile.name}</strong>.
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 flex-shrink-0"
              aria-label="Descartar aviso"
              onClick={() => dismiss(alert.id)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 pl-6">
            <Button size="sm" variant="outline" onClick={() => onCompare(alert)}>
              Ver qué cambió
            </Button>
            <Button size="sm" variant="ghost" onClick={() => dismiss(alert.id)}>
              Entendido
            </Button>
          </div>
        </div>
      ))}
    </div>
  )
}

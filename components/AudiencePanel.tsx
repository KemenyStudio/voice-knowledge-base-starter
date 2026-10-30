"use client"

import { useState } from "react"
import { Loader2, Sparkles, Tags, Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import {
  audienceLabelMessage,
  labelAudiencesWithAi,
} from "@/lib/knowledge/label-audiences"
import type { AudienceStatus } from "@/types/knowledge"

interface AudienceFile {
  audience_status?: AudienceStatus
  audience_suggested?: string[]
  sync_status?: string
  metadata?: { target_tag?: string[] } | null
}

type Busy = "tags" | "suggest" | "accept" | null

/**
 * Library panel (admins): which entity types each document applies to.
 * Everything here is explicit; nothing is hidden from search until the
 * assistant's entity filter is switched on in Asistente.
 */
export default function AudiencePanel({
  chatbotId,
  files,
  filterOn,
  onChanged,
  density = "card",
}: {
  chatbotId: string
  files: AudienceFile[]
  filterOn: boolean
  onChanged: () => void
  /** `row` sits inside the Biblioteca status strip; `card` is a standalone block. */
  density?: "card" | "row"
}) {
  const { toast } = useToast()
  const [busy, setBusy] = useState<Busy>(null)

  const confirmed = files.filter((f) => f.audience_status === "confirmed").length
  const suggested = files.filter((f) => f.audience_status === "suggested").length
  const unclassified = files.length - confirmed - suggested
  const classifiable = files.filter(
    (f) =>
      f.sync_status === "ready" &&
      (!(f.metadata?.target_tag?.length) ||
        (f.audience_status ?? "unclassified") === "unclassified")
  ).length

  const call = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/files/audience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatbotId, ...body }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || "No se pudo completar la acción")
    return data
  }

  const run = async (kind: Exclude<Busy, null>, action: () => Promise<string>) => {
    setBusy(kind)
    try {
      toast({ description: await action() })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error",
        variant: "destructive",
      })
    } finally {
      setBusy(null)
      onChanged()
    }
  }

  const importFromTags = () =>
    run("tags", async () => {
      const data = await call({ action: "from_tags" })
      return `${data.imported} documentos clasificados desde sus etiquetas; ${data.unmatched} sin coincidencia.`
    })

  const suggestWithAi = () =>
    run("suggest", async () => {
      const { labeled, failed } = await labelAudiencesWithAi(chatbotId)
      return audienceLabelMessage(labeled, failed)
    })

  const acceptSuggestions = () =>
    run("accept", async () => {
      const data = await call({ action: "accept" })
      return `${data.accepted} sugerencias aceptadas.`
    })

  return (
    <div
      className={
        density === "row"
          ? "px-3 py-2"
          : "mt-4 rounded-lg border bg-gray-50 p-4 dark:bg-gray-900"
      }
      data-testid="audience-panel"
    >
      <div className={density === "row" ? "flex flex-col gap-2" : "flex flex-wrap items-center justify-between gap-2"}>
        <p className="min-w-0 text-sm leading-snug">
          <span className="inline-flex items-center gap-2 font-medium">
            <Tags className="h-4 w-4 shrink-0 text-blue-500" />
            Audiencia de los documentos
          </span>
          <span
            className="text-muted-foreground"
            title={
              filterOn
                ? "El filtro por perfil está activado."
                : "El filtro por perfil está desactivado: nada se oculta todavía."
            }
          >
            {" "}
            · {confirmed} confirmados · {suggested} con sugerencia · {unclassified}{" "}
            sin clasificar
            {filterOn ? " · filtro activo" : " · filtro apagado"}
          </span>
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || unclassified === 0}
            onClick={importFromTags}
          >
            {busy === "tags" && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Importar de las etiquetas
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={busy !== null || classifiable === 0}
            onClick={suggestWithAi}
          >
            {busy === "suggest" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            Sugerir con IA
          </Button>
          <Button
            size="sm"
            disabled={busy !== null || suggested === 0}
            onClick={acceptSuggestions}
          >
            {busy === "accept" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Check className="mr-2 h-4 w-4" />
            )}
            Aceptar sugerencias ({suggested})
          </Button>
        </div>
      </div>
    </div>
  )
}

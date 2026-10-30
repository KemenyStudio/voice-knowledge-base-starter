"use client"

import { useEffect, useState } from "react"
import { Loader2, Settings2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { useToast } from "@/hooks/use-toast"
import { suggestedToText, textToSuggested } from "@/lib/chat/suggested"
import { TOOLS, TOOL_IDS, normalizeTools, type ToolId } from "@/lib/tools/registry"
import type { Chatbot } from "@/types/chatbot"

interface ToolRun {
  id: string
  tool: string
  status: string
  user_email: string | null
  created_at: string
}

/** Admin view: name, welcome text and example questions of the assistant. */
export default function AssistantSettings({
  chatbot,
  onSaved,
}: {
  chatbot: Chatbot
  onSaved: (updated: Partial<Chatbot>) => void
}) {
  const { toast } = useToast()
  const [name, setName] = useState(chatbot.name)
  const [description, setDescription] = useState(chatbot.description ?? "")
  const [welcome, setWelcome] = useState(chatbot.welcome_message ?? "")
  const [questions, setQuestions] = useState(
    suggestedToText(chatbot.suggested_questions ?? [])
  )
  const [audienceText, setAudienceText] = useState(
    (chatbot.audience_options ?? []).join("\n")
  )
  const [audienceFilter, setAudienceFilter] = useState(
    Boolean(chatbot.audience_filter)
  )
  const [notes, setNotes] = useState((chatbot.prompt_notes ?? []).join("\n"))
  const [researchEnabled, setResearchEnabled] = useState(
    chatbot.research_enabled !== false
  )
  const [tools, setTools] = useState<ToolId[]>(normalizeTools(chatbot.enabled_tools))
  const [runs, setRuns] = useState<ToolRun[] | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    fetch(`/api/tools/runs?chatbotId=${chatbot.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => !cancelled && setRuns(data?.runs ?? []))
      .catch(() => !cancelled && setRuns([]))
    return () => {
      cancelled = true
    }
  }, [chatbot.id])

  useEffect(() => {
    setName(chatbot.name)
    setDescription(chatbot.description ?? "")
    setWelcome(chatbot.welcome_message ?? "")
    setQuestions(suggestedToText(chatbot.suggested_questions ?? []))
    setAudienceText((chatbot.audience_options ?? []).join("\n"))
    setAudienceFilter(Boolean(chatbot.audience_filter))
    setNotes((chatbot.prompt_notes ?? []).join("\n"))
    setResearchEnabled(chatbot.research_enabled !== false)
    setTools(normalizeTools(chatbot.enabled_tools))
  }, [chatbot])

  const audienceOptions = audienceText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      const res = await fetch(`/api/chatbots/${chatbot.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          description,
          welcome_message: welcome.trim() || null,
          suggested_questions: textToSuggested(questions),
          audience_options: audienceOptions,
          audience_filter: audienceOptions.length > 0 && audienceFilter,
          prompt_notes: notes
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          research_enabled: researchEnabled,
          enabled_tools: tools,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || "No se pudo guardar")
      onSaved(data)

      const before = (chatbot.audience_options ?? []).join("\n")
      const after = (data.audience_options ?? []).join("\n")
      if (before !== after && (data.audience_options ?? []).length > 0) {
        // Documents carry the entity types in the search index; rewrite them.
        let offset: number | null = 0
        while (offset !== null) {
          const sync = await fetch("/api/files/audience", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "sync", chatbotId: chatbot.id, offset }),
          })
          const result = await sync.json().catch(() => ({}))
          if (!sync.ok) throw new Error(result.error || "No se pudo actualizar el índice")
          offset = result.next ?? null
        }
      }
      toast({ description: "Cambios guardados." })
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Error",
        variant: "destructive",
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      <div className="min-h-0 w-full min-w-0 max-w-full flex-1 overflow-x-hidden overflow-y-auto p-3 pb-[max(1rem,env(safe-area-inset-bottom))] sm:p-4">
        <Card className="mx-auto w-full min-w-0 max-w-3xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-3 text-2xl font-bold">
            <Settings2 className="h-6 w-6 text-blue-500" />
            Asistente
          </CardTitle>
          <CardDescription>
            Lo que ven los miembros del equipo al abrir el chat.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={save} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="assistant-name">Nombre</Label>
              <Input
                id="assistant-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                maxLength={80}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assistant-description">Descripción</Label>
              <Textarea
                id="assistant-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                maxLength={500}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assistant-welcome">Mensaje de bienvenida</Label>
              <Textarea
                id="assistant-welcome"
                value={welcome}
                onChange={(e) => setWelcome(e.target.value)}
                maxLength={600}
                placeholder="Si lo dejas vacío se usa un mensaje genérico con el nombre del asistente."
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="assistant-questions">Preguntas de ejemplo</Label>
              <Textarea
                id="assistant-questions"
                value={questions}
                onChange={(e) => setQuestions(e.target.value)}
                className="min-h-[220px] font-mono text-sm"
                placeholder={"## Categoría\nPrimera pregunta\nSegunda pregunta"}
              />
              <p className="text-xs text-muted-foreground">
                Una pregunta por línea. Una línea que empieza con ## abre una
                categoría. El chat vacío muestra como máximo seis, en una línea
                cada una, dentro de las primeras tres categorías.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="assistant-notes">Notas para el asistente</Label>
              <Textarea
                id="assistant-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="min-h-[100px] text-sm"
                placeholder={"Cuando citen un documento, incluye el título y la sección."}
              />
              <p className="text-xs text-muted-foreground">
                Una indicación por línea (máximo 10, 300 caracteres cada una). Se
                añaden a las instrucciones del asistente; sirven para corregir
                errores que aparecen en la retroalimentación.
              </p>
            </div>
            <div className="space-y-3 rounded-lg border p-4">
              <div className="space-y-2">
                <Label htmlFor="assistant-audience">Perfiles de audiencia</Label>
                <Textarea
                  id="assistant-audience"
                  value={audienceText}
                  onChange={(e) => setAudienceText(e.target.value)}
                  className="min-h-[120px] font-mono text-sm"
                  placeholder={"Equipo de producto\nEquipo legal\nClientes"}
                />
                <p className="text-xs text-muted-foreground">
                  Uno por línea, máximo 8. Quien chatea elige el suyo y el
                  asistente lo recuerda. Déjalo vacío si todos los documentos
                  aplican a todo el mundo.
                </p>
              </div>
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Label htmlFor="assistant-audience-filter">
                    Buscar solo en documentos aplicables
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Omite los documentos marcados para otros perfiles. Los
                    documentos sin clasificar siempre se buscan. Revisa antes la
                    audiencia en la Biblioteca.
                  </p>
                </div>
                <Switch
                  id="assistant-audience-filter"
                  checked={audienceFilter && audienceOptions.length > 0}
                  disabled={audienceOptions.length === 0}
                  onCheckedChange={setAudienceFilter}
                />
              </div>
            </div>
            <div className="space-y-3 rounded-lg border p-4" data-testid="agent-features">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <Label htmlFor="assistant-research">Investigar a fondo</Label>
                  <p className="text-xs text-muted-foreground">
                    Los usuarios pueden activarlo en una pregunta: el asistente
                    planea varias búsquedas, muestra cada paso y redacta una sola
                    respuesta. Usa más tiempo y costo que una respuesta normal
                    (límite de 15 por usuario al día).
                  </p>
                </div>
                <Switch
                  id="assistant-research"
                  checked={researchEnabled}
                  onCheckedChange={setResearchEnabled}
                />
              </div>
              <div className="space-y-2">
                <Label>Herramientas bajo las respuestas</Label>
                <p className="text-xs text-muted-foreground">
                  Fuente oficial más reciente está siempre bajo la respuesta.
                  Busca en la web y marca esos resultados como web. No sustituye
                  la biblioteca.
                </p>
                {TOOL_IDS.map((id) => (
                  <label key={id} className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={tools.includes(id)}
                      onChange={(e) =>
                        setTools((prev) =>
                          e.target.checked
                            ? [...prev, id]
                            : prev.filter((t) => t !== id)
                        )
                      }
                    />
                    <span>
                      <span className="font-medium">{TOOLS[id].label}</span>
                      <span className="block text-xs text-muted-foreground">
                        {TOOLS[id].description}
                      </span>
                    </span>
                  </label>
                ))}
                <p className="text-xs text-muted-foreground">
                  Solo generan texto para copiar: no envían ni cambian nada. Cada
                  uso queda registrado.
                </p>
              </div>
              {runs && runs.length > 0 && (
                <details className="text-sm" data-testid="tool-runs">
                  <summary className="cursor-pointer font-medium">
                    Registro de uso ({runs.length} recientes)
                  </summary>
                  <ul className="mt-2 divide-y rounded-md border text-xs">
                    {runs.map((run) => (
                      <li key={run.id} className="flex flex-wrap justify-between gap-2 p-2">
                        <span>
                          {TOOLS[run.tool as ToolId]?.label ?? run.tool}
                          {run.status === "error" ? " (error)" : ""}
                        </span>
                        <span className="text-muted-foreground">
                          {run.user_email ?? "—"} ·{" "}
                          {new Date(run.created_at).toLocaleString("es-MX")}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Guardar cambios
            </Button>
          </form>
        </CardContent>
        </Card>
      </div>
    </div>
  )
}

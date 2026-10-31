"use client"

import { FormEvent, useState } from "react"

import { ResultsArea, type Result } from "@/components/chat/ResultsPanel"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface HarnessResponse {
  answer?: string
  citations?: Array<{ number: number; title: string; text: string }>
  error?: string
}

/**
 * Local page the computer-use harness drives. Fuentes stays closed until the
 * operator opens it, so a screenshot of the cited passage is a real step.
 */
export function HarnessKnowledge() {
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState("")
  const [results, setResults] = useState<Result[]>([])
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  const ask = async (event: FormEvent) => {
    event.preventDefault()
    const text = question.trim()
    if (!text || pending) return
    setPending(true)
    setError("")
    setAnswer("")
    setResults([])
    setOpen(false)
    try {
      const response = await fetch("/api/harness/kb", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text }),
      })
      const data = (await response.json().catch(() => ({}))) as HarnessResponse
      if (!response.ok) {
        setError(data.error || "No se pudo consultar la fuente aislada.")
        return
      }
      setAnswer(data.answer || "")
      setResults(
        (data.citations ?? []).map((citation) => ({
          number: citation.number,
          title: citation.title,
          extract: citation.text,
          url: "",
          location: { page: null, article: null, fileLocation: null },
        }))
      )
    } catch {
      setError("No se pudo consultar la fuente aislada.")
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="app-screen flex min-h-0 bg-[#141414] text-zinc-100">
      <main className="flex min-w-0 flex-1 flex-col px-8 py-8">
        <p className="text-xs uppercase tracking-wide text-zinc-400">
          Corpus aislado
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Pregunta</h1>
        <form onSubmit={ask} className="mt-6 max-w-xl space-y-3">
          <label className="block text-sm text-zinc-300" htmlFor="harness-question">
            Pregunta
          </label>
          <Textarea
            id="harness-question"
            aria-label="Pregunta"
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Escribe tu pregunta..."
            className="min-h-[88px] border-white/10 bg-[#2a2a2a]"
          />
          <Button type="submit" disabled={pending} aria-label="Enviar">
            {pending ? "Buscando" : "Enviar"}
          </Button>
        </form>
        {error && (
          <p className="mt-6 text-sm text-red-300" data-testid="harness-error">
            {error}
          </p>
        )}
        {answer && (
          <p className="mt-6 max-w-xl text-base leading-7" data-testid="harness-answer">
            {answer}
          </p>
        )}
      </main>
      <aside className="flex w-[380px] shrink-0 flex-col border-l border-white/10">
        <div className="border-b border-white/10 px-3 py-2.5">
          <button
            type="button"
            className="text-sm font-semibold tracking-tight"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            Fuentes
          </button>
          <p className="text-xs text-zinc-400">
            {open ? "Fragmentos citados" : "Cerrado"}
          </p>
        </div>
        {open ? (
          <ResultsArea results={results} />
        ) : (
          <p className="px-4 py-4 text-sm text-zinc-400">
            Abre Fuentes para ver el fragmento citado.
          </p>
        )}
      </aside>
    </div>
  )
}

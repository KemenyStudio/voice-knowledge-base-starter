import type { VectorStoreSearchResponse } from "openai/resources/vector-stores/vector-stores"

import { aiConfig, getOpenAI } from "@/lib/openai"
import { FILE_SEARCH_MAX_RESULTS, vectorSearchRanking } from "@/lib/retrieval"

/** Upper bounds that keep a research question at roughly two model calls of cost. */
export const MAX_SUB_QUESTIONS = 4
export const RESULTS_PER_SUB_QUESTION = FILE_SEARCH_MAX_RESULTS
export const MAX_EVIDENCE_DOCUMENTS = 12
export const PASSAGES_PER_DOCUMENT = 4
/** Covers a default 800-token chunk so the stored passage is not cut mid-fact. */
export const PASSAGE_MAX_CHARS = 3500
/** Research answers per user and assistant in 24 hours. */
export const RESEARCH_DAILY_LIMIT = 15

export interface SubQuestion {
  id: number
  /** What the user sees while it runs, e.g. "Buscando requisitos de capital". */
  label: string
  /** Self-contained query sent to the search. */
  query: string
}

export interface Passage {
  text: string
  score: number
}

export interface EvidenceDocument {
  /** Citation number the model must use for this document. */
  number: number
  fileId: string
  filename: string
  score: number
  attributes: Record<string, string | number | boolean>
  passages: Passage[]
}

export interface SearchHit {
  file_id: string
  filename: string
  score: number
  attributes: Record<string, string | number | boolean>
  text: string
}

const clean = (value: unknown, max: number) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : ""

/** Turns the planner's JSON into sub-questions. Never returns an empty plan. */
export function parsePlan(raw: string, question: string): SubQuestion[] {
  const fallback: SubQuestion[] = [
    { id: 1, label: "Buscando en los documentos", query: question },
  ]
  try {
    const parsed = JSON.parse(raw) as { steps?: unknown }
    if (!Array.isArray(parsed.steps)) return fallback
    const seen = new Set<string>()
    const steps: SubQuestion[] = []
    for (const item of parsed.steps) {
      const query = clean((item as { query?: unknown })?.query, 300)
      const label = clean((item as { label?: unknown })?.label, 80)
      if (query.length < 4 || seen.has(query.toLowerCase())) continue
      seen.add(query.toLowerCase())
      steps.push({ id: steps.length + 1, label: label || query.slice(0, 60), query })
      if (steps.length === MAX_SUB_QUESTIONS) break
    }
    return steps.length > 0 ? steps : fallback
  } catch {
    return fallback
  }
}

/**
 * Breaks a broad question into independent searches. Best effort: any failure
 * degrades to one search with the original question.
 */
export async function planResearch(input: {
  assistantName: string
  question: string
  previousQuestion?: string
}): Promise<SubQuestion[]> {
  try {
    const response = await getOpenAI().responses.create({
      model: aiConfig.utilityModel,
      reasoning: { effort: aiConfig.utilityEffort },
      text: {
        verbosity: "low",
        format: {
          type: "json_schema",
          name: "research_plan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            required: ["steps"],
            properties: {
              steps: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "query"],
                  properties: {
                    label: { type: "string" },
                    query: { type: "string" },
                  },
                },
              },
            },
          },
        },
      },
      max_output_tokens: 700,
      store: false,
      instructions: `Eres el planificador de búsqueda del asistente "${input.assistantName}". Divide la pregunta del usuario en entre 2 y ${MAX_SUB_QUESTIONS} búsquedas independientes en la base de documentos que, juntas, permitan responderla a fondo (por ejemplo: definiciones, requisitos, excepciones, plazos, diferencias entre apartados).
- "query": consulta autosuficiente (sin pronombres), en el idioma del usuario, de máximo 200 caracteres.
- "label": lo que ve el usuario mientras corre, empieza con un gerundio ("Buscando definiciones"), máximo 60 caracteres.
- No repitas búsquedas. Si la pregunta es simple, devuelve solo 2.`,
      input: `${input.previousQuestion ? `Pregunta anterior: ${input.previousQuestion}\n` : ""}Pregunta: ${input.question}`,
    })
    return parsePlan(response.output_text, input.question)
  } catch (error) {
    console.error("planResearch", error)
    return parsePlan("", input.question)
  }
}

type SearchFilter = NonNullable<
  Parameters<ReturnType<typeof getOpenAI>["vectorStores"]["search"]>[1]["filters"]
>

/** One search over the assistant's documents. */
export async function runSearch(input: {
  vectorStoreId: string
  query: string
  filter: SearchFilter | null
}): Promise<SearchHit[]> {
  const page = await getOpenAI().vectorStores.search(input.vectorStoreId, {
    query: input.query,
    max_num_results: RESULTS_PER_SUB_QUESTION,
    rewrite_query: true,
    ranking_options: vectorSearchRanking(),
    ...(input.filter ? { filters: input.filter } : {}),
  })
  return flattenResults(page.data)
}

export function flattenResults(results: VectorStoreSearchResponse[]): SearchHit[] {
  return results.flatMap((result) =>
    result.content
      .filter((part) => part.type === "text" && part.text.trim())
      .map((part) => ({
        file_id: result.file_id,
        filename: result.filename,
        score: result.score ?? 0,
        attributes: result.attributes ?? {},
        text: part.text,
      }))
  )
}

/**
 * Merges the hits of every sub-question into numbered documents: best
 * documents first, a few distinct passages each, bounded in size.
 */
export function buildEvidence(hitsBySearch: SearchHit[][]): EvidenceDocument[] {
  const byFile = new Map<string, EvidenceDocument>()
  for (const hit of hitsBySearch.flat()) {
    const key = hit.file_id || hit.filename
    if (!key) continue
    let doc = byFile.get(key)
    if (!doc) {
      doc = {
        number: 0,
        fileId: hit.file_id,
        filename: hit.filename,
        score: hit.score,
        attributes: hit.attributes,
        passages: [],
      }
      byFile.set(key, doc)
    }
    doc.score = Math.max(doc.score, hit.score)
    const text = hit.text.trim().slice(0, PASSAGE_MAX_CHARS)
    if (!doc.passages.some((p) => p.text === text)) {
      doc.passages.push({ text, score: hit.score })
    }
  }

  return Array.from(byFile.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_EVIDENCE_DOCUMENTS)
    .map((doc, index) => ({
      ...doc,
      number: index + 1,
      passages: doc.passages
        .sort((a, b) => b.score - a.score)
        .slice(0, PASSAGES_PER_DOCUMENT),
    }))
}

/** Number of distinct documents a sub-question found. */
export function countDocuments(hits: SearchHit[]): number {
  return new Set(hits.map((h) => h.file_id || h.filename)).size
}

/** The model input of the writing step: the question and the numbered evidence. */
export function evidenceInput(
  question: string,
  steps: SubQuestion[],
  evidence: EvidenceDocument[]
): string {
  const body = evidence
    .map(
      (doc) =>
        `[${doc.number}] ${doc.filename}\n${doc.passages
          .map((p, i) => `  Pasaje ${i + 1}: ${p.text}`)
          .join("\n")}`
    )
    .join("\n\n")
  return `Pregunta del usuario:\n${question}\n\nBúsquedas realizadas:\n${steps
    .map((s) => `- ${s.query}`)
    .join("\n")}\n\n# Evidencia recuperada\n\n${body || "(No se encontraron pasajes.)"}`
}

export const RESEARCH_INSTRUCTIONS = `

# Tarea: investigación a fondo

Ya se realizaron varias búsquedas en los documentos y la evidencia numerada está en el mensaje del usuario. No tienes herramientas de búsqueda: usa únicamente esa evidencia.
- Redacta una respuesta completa y estructurada (secciones o una tabla si ayuda a comparar).
- Cita cada dato con el número de la evidencia, por ejemplo [3]. Usa el número tal como aparece, aunque no sean consecutivos, y no cites documentos que no uses.
- Si la evidencia no cubre una parte de la pregunta, dilo expresamente en lugar de suponerlo.
- Cada cifra, plazo, correo o artículo tiene que aparecer en uno de los pasajes. Si no está, no lo afirmes.
- Si dos documentos se contradicen o uno parece más reciente, señálalo.
- Termina con la sección "Referencias:" en el formato de siempre: [N] título del documento y, si se conocen, las secciones o artículos.
- No pidas aclaraciones: responde con lo disponible.`

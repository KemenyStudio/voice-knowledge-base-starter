import { extractNumericSummary } from "@/lib/mcp/documents"

export interface UsageVote {
  evaluation_set: string
  is_positive: boolean | null
}

export interface StoredEvaluation {
  evaluation_set: string
  timestamp: string | null
  data: string | null
}

export type SummaryKind = "count" | "rate" | "score"

export interface SummaryFigure {
  key: string
  label: string
  value: number
  kind: SummaryKind
}

export interface EvaluationSetMetrics {
  evaluationSet: string
  label: string
  pass: number
  fail: number
  blank: number
  evaluatedAt: string | null
  summary: SummaryFigure[]
}

export interface UsagePayload {
  usage: {
    questions: number
    answers: number
    conversations: number
    people: number
    questions7d: number
    questions30d: number
  }
  evaluations: {
    sets: EvaluationSetMetrics[]
    truncated: boolean
  }
  ratings: {
    positive: number
    negative: number
    open: number
  }
  unsourcedAnswers: number
  telemetry: {
    /** Answer latency is not stored. */
    answerLatencyMs: null
    /** Model call failures are not stored. */
    modelErrors: null
    tools: {
      runs: number
      errors: number
      avgMs: number | null
      maxMs: number | null
    }
    modelCalls: {
      withModel: number
      withoutModel: number
      other: number
    }
    retrieval: {
      withSources: number
      citationCount: number
      researchAnswers: number
      documents: number
      indexReady: number
      indexFailed: number
      uncitedDocuments: number
    }
  }
}

const SUMMARY_LABELS: Record<string, string> = {
  total_responses: "Respuestas",
  acceptable_responses: "Aceptables",
  acceptance_rate: "Tasa",
  average_score: "Puntaje",
}

const SUMMARY_ORDER = [
  "total_responses",
  "acceptable_responses",
  "acceptance_rate",
  "average_score",
]

function count(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function countOrNull(value: unknown): number | null {
  if (value == null) return null
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return null
}

export function summaryKind(key: string): SummaryKind {
  if (key === "acceptance_rate" || key.endsWith("_rate")) return "rate"
  if (key === "average_score" || key.endsWith("_score")) return "score"
  return "count"
}

export function shortEvaluationLabel(evaluationSet: string): string {
  const match = /evaluation_results_(\d{4})(\d{2})(\d{2})_(\d{2})(\d{2})/.exec(
    evaluationSet
  )
  if (!match) return evaluationSet
  const [, year, month, day, hour, minute] = match
  return `${day}/${month}/${year} ${hour}:${minute}`
}

function summaryFigures(data: string | null): SummaryFigure[] {
  const summary = extractNumericSummary(data)
  if (!summary) return []
  const keys = Object.keys(summary).sort((a, b) => {
    const ai = SUMMARY_ORDER.indexOf(a)
    const bi = SUMMARY_ORDER.indexOf(b)
    if (ai === -1 && bi === -1) return a.localeCompare(b)
    if (ai === -1) return 1
    if (bi === -1) return -1
    return ai - bi
  })
  return keys.map((key) => ({
    key,
    label: SUMMARY_LABELS[key] ?? key,
    value: summary[key] ?? 0,
    kind: summaryKind(key),
  }))
}

export function groupEvaluations(
  votes: readonly UsageVote[],
  stored: readonly StoredEvaluation[]
): EvaluationSetMetrics[] {
  const bySet = new Map<string, { pass: number; fail: number; blank: number }>()
  for (const vote of votes) {
    const current = bySet.get(vote.evaluation_set) ?? { pass: 0, fail: 0, blank: 0 }
    if (vote.is_positive === true) current.pass += 1
    else if (vote.is_positive === false) current.fail += 1
    else current.blank += 1
    bySet.set(vote.evaluation_set, current)
  }

  const storedBySet = new Map(stored.map((row) => [row.evaluation_set, row]))
  return Array.from(bySet.keys())
    .sort()
    .map((evaluationSet) => {
      const counts = bySet.get(evaluationSet) ?? { pass: 0, fail: 0, blank: 0 }
      const row = storedBySet.get(evaluationSet)
      return {
        evaluationSet,
        label: shortEvaluationLabel(evaluationSet),
        pass: counts.pass,
        fail: counts.fail,
        blank: counts.blank,
        evaluatedAt: row?.timestamp ?? null,
        summary: summaryFigures(row?.data ?? null),
      }
    })
}

/** Shapes the SQL aggregate and this assistant's eval votes. Missing telemetry stays null. */
export function buildUsagePayload(
  raw: Record<string, unknown>,
  votes: readonly UsageVote[],
  stored: readonly StoredEvaluation[],
  options?: { votesTruncated?: boolean }
): UsagePayload {
  return {
    usage: {
      questions: count(raw.questions),
      answers: count(raw.answers),
      conversations: count(raw.conversations),
      people: count(raw.people),
      questions7d: count(raw.questions_7d),
      questions30d: count(raw.questions_30d),
    },
    evaluations: {
      sets: groupEvaluations(votes, stored),
      truncated: options?.votesTruncated === true,
    },
    ratings: {
      positive: count(raw.ratings_positive),
      negative: count(raw.ratings_negative),
      open: count(raw.ratings_open),
    },
    unsourcedAnswers: count(raw.answers_without_sources),
    telemetry: {
      answerLatencyMs: null,
      modelErrors: null,
      tools: {
        runs: count(raw.tool_runs),
        errors: count(raw.tool_errors),
        avgMs: countOrNull(raw.tool_duration_avg_ms),
        maxMs: countOrNull(raw.tool_duration_max_ms),
      },
      modelCalls: {
        withModel: count(raw.model_answers),
        withoutModel: count(raw.local_answers),
        other: count(raw.other_answers),
      },
      retrieval: {
        withSources: count(raw.answers_with_sources),
        citationCount: count(raw.citation_count),
        researchAnswers: count(raw.research_answers),
        documents: count(raw.documents),
        indexReady: count(raw.index_ready),
        indexFailed: count(raw.index_failed),
        uncitedDocuments: count(raw.uncited_documents),
      },
    },
  }
}

export function asMetricsRecord(data: unknown): Record<string, unknown> {
  const value = typeof data === "string" ? JSON.parse(data) : data
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("La consulta de uso no devolvió cifras.")
  }
  return value as Record<string, unknown>
}

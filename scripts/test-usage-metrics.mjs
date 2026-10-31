// Unit checks for the Uso payload.   node scripts/test-usage-metrics.mjs
import assert from "node:assert/strict"
import { register } from "node:module"

register(new URL("./resolve-alias.mjs", import.meta.url).href)

const { buildUsagePayload, summaryKind, shortEvaluationLabel } = await import(
  "../lib/usage/metrics.ts"
)

const raw = {
  questions: "12",
  answers: 9,
  conversations: 4,
  people: 3,
  questions_7d: 2,
  questions_30d: 8,
  model_answers: 7,
  local_answers: 2,
  other_answers: 0,
  answers_with_sources: 5,
  answers_without_sources: 1,
  citation_count: 11,
  research_answers: 1,
  ratings_positive: 4,
  ratings_negative: 2,
  ratings_open: 3,
  tool_runs: 6,
  tool_errors: 1,
  tool_duration_avg_ms: "840",
  tool_duration_max_ms: 2100,
  documents: 20,
  index_ready: 18,
  index_failed: 1,
  uncited_documents: 4,
}

const payload = buildUsagePayload(
  raw,
  [
    { evaluation_set: "evaluation_results_20250220_130132", is_positive: true },
    { evaluation_set: "evaluation_results_20250220_130132", is_positive: false },
    { evaluation_set: "evaluation_results_20250220_130132", is_positive: null },
    { evaluation_set: "set-b", is_positive: false },
  ],
  [
    {
      evaluation_set: "evaluation_results_20250220_130132",
      timestamp: "2025-02-20T13:01:32Z",
      data: JSON.stringify({
        summary: {
          total_responses: 70,
          acceptable_responses: 10,
          acceptance_rate: 0.14,
          average_score: 0.5,
          question: "no es número",
        },
      }),
    },
  ]
)

assert.equal(payload.usage.questions, 12)
assert.equal(payload.usage.questions7d, 2)
assert.equal(payload.telemetry.answerLatencyMs, null)
assert.equal(payload.telemetry.modelErrors, null)
assert.equal(payload.telemetry.tools.avgMs, 840)
assert.equal(payload.telemetry.tools.maxMs, 2100)
assert.equal(payload.telemetry.modelCalls.withModel, 7)
assert.equal(payload.telemetry.modelCalls.withoutModel, 2)
assert.equal(payload.unsourcedAnswers, 1)
assert.equal(payload.ratings.negative, 2)
assert.equal(payload.evaluations.sets.length, 2)
assert.equal(payload.evaluations.sets[0].label, "20/02/2025 13:01")
assert.equal(payload.evaluations.sets[0].pass, 1)
assert.equal(payload.evaluations.sets[0].fail, 1)
assert.equal(payload.evaluations.sets[0].blank, 1)
assert.deepEqual(
  payload.evaluations.sets[0].summary.map((figure) => figure.key),
  ["total_responses", "acceptable_responses", "acceptance_rate", "average_score"]
)
assert.equal(payload.evaluations.sets[0].summary[2].kind, "rate")
assert.equal(payload.evaluations.sets[1].evaluationSet, "set-b")
assert.equal(payload.evaluations.sets[1].summary.length, 0)
assert.equal(summaryKind("acceptance_rate"), "rate")
assert.equal(summaryKind("average_score"), "score")
assert.equal(summaryKind("total_responses"), "count")
assert.equal(shortEvaluationLabel("manual"), "manual")

const empty = buildUsagePayload({}, [], [])
assert.equal(empty.usage.questions, 0)
assert.equal(empty.telemetry.tools.avgMs, null)
assert.equal(empty.telemetry.answerLatencyMs, null)
assert.equal(empty.evaluations.sets.length, 0)

console.log("usage metrics ok")

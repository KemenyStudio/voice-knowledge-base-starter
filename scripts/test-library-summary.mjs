// Unit checks for the Biblioteca summary.   node scripts/test-library-summary.mjs
import assert from "node:assert/strict"
import { register } from "node:module"

register(new URL("./resolve-alias.mjs", import.meta.url).href)

const { buildLibrarySummary } = await import("../lib/knowledge/library-summary.ts")

const now = Date.parse("2026-10-28T12:00:00Z")
const weak = {
  verdict: "review",
  reasons: ["No pudimos extraer texto de este archivo."],
}

function file(overrides) {
  return {
    id: overrides.id,
    file_name: overrides.file_name ?? overrides.id,
    uploaded_at: "2026-10-01T00:00:00Z",
    sync_status: "ready",
    openai_file_id: "file-local",
    vector_store_id: "vs-local",
    audience: ["Bancos"],
    audience_status: "confirmed",
    index_health_score: 35,
    index_health: weak,
    sync_error: null,
    ...overrides,
  }
}

const files = []
for (let index = 0; index < 146; index += 1) {
  files.push(file({ id: `ready-${index}` }))
}
for (let index = 0; index < 17; index += 1) {
  files.push(file({ id: `audience-${index}`, audience: [] }))
}
files.push(
  file({
    id: "failed",
    sync_status: "failed",
    sync_error: "The file could not be parsed because it is empty.",
  })
)
files.push(
  file({
    id: "external",
    sync_status: "external",
    openai_file_id: null,
    index_health_score: null,
    index_health: { verdict: "unknown", reasons: ["No hay archivo original para evaluarlo."] },
  })
)

const index = {
  filesCompleted: 164,
  filesFailed: 1,
  filesCancelled: 0,
  filesInProgress: 0,
  filesTotal: 165,
  usageBytes: 1000,
}

const summary = buildLibrarySummary(files, { audienceEnabled: true, now, index })
assert.equal(summary.counts.documents, 165)
assert.equal(summary.counts.ready, 163)
assert.equal(summary.counts.needsAttention, 2)
assert.equal(summary.counts.missingAudience, 17)
assert.equal(summary.counts.weakIndex, 164)
assert.equal(summary.counts.processing, 0)
assert.equal(summary.counts.indexFiles, 164)
assert.equal(summary.counts.chunks, null)
assert.equal(summary.sources.indexFiles, "vector_store")
assert.equal(summary.sources.chunks, "unavailable")
assert.equal(summary.sources.documents, "library")
assert.match(summary.quality, /164 de 165 tienen un índice débil/)
assert.match(summary.quality, /no pudimos extraer texto de este archivo/)
assert.match(summary.quality, /17 sin audiencia/)
assert.match(summary.quality, /2 necesitan atención/)
assert.match(summary.quality, /163 listos para responder/)
assert.equal(summary.worst.length, 5)
assert.equal(summary.worst[0].id, "failed")
assert.equal(summary.worst[0].needsAttention, true)
assert.match(summary.worst[0].reasons[0], /vacío/)
assert.equal(summary.worst[1].id, "external")
assert.equal(summary.worst[2].missingAudience, true)
assert.equal(JSON.stringify(summary.worst).includes("file-local"), false)
assert.equal(JSON.stringify(summary.worst).includes("vs-local"), false)
assert.equal(summary.index.chunks, null)
assert.equal(summary.index.usageBytes, 1000)

const withoutIndex = buildLibrarySummary(files, { audienceEnabled: true, now, index: null })
assert.equal(withoutIndex.counts.indexFiles, null)
assert.equal(withoutIndex.sources.indexFiles, "unavailable")
assert.equal(withoutIndex.counts.missingAudience, 17)

const audienceOff = buildLibrarySummary(files, { audienceEnabled: false, now })
assert.equal(audienceOff.counts.missingAudience, 0)

const healthy = buildLibrarySummary(
  [
    file({
      id: "ok",
      index_health_score: 100,
      index_health: { verdict: "good", reasons: [] },
    }),
  ],
  { audienceEnabled: true, now }
)
assert.equal(healthy.counts.weakIndex, 0)
assert.equal(healthy.counts.ready, 1)
assert.equal(healthy.quality, "El documento está listo para responder.")

assert.equal(
  buildLibrarySummary([], { audienceEnabled: true, now }).quality,
  "No hay documentos en la biblioteca."
)

const young = file({
  id: "indexing",
  sync_status: "processing",
  uploaded_at: "2026-10-28T11:50:00Z",
})
const inflight = buildLibrarySummary([young], { audienceEnabled: true, now })
assert.equal(inflight.counts.processing, 1)
assert.equal(inflight.counts.needsAttention, 0)
assert.equal(inflight.counts.ready, 0)

console.log("library summary: ok")

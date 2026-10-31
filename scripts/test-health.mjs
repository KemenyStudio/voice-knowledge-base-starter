// Unit checks for the library health report.   node scripts/test-health.mjs
import assert from "node:assert/strict"
import { buildHealthReport, explainSyncError } from "../lib/knowledge/health.ts"

const base = { uploaded_at: "2026-10-01T00:00:00Z", metadata: { type_tag: "Manual", target_tag: ["Grupo A"] }, audience_status: "confirmed", outdated: false, outdated_note: null, sync_error: null }
const files = [
  { ...base, id: "1", file_name: "ok", sync_status: "ready", openai_file_id: "f1", vector_store_id: "v", blob_name: "b" },
  { ...base, id: "2", file_name: "dcg", sync_status: "external", openai_file_id: null, vector_store_id: null, blob_name: null },
  { ...base, id: "3", file_name: "empty", sync_status: "failed", sync_error: "The file could not be parsed because it is empty.", openai_file_id: "f3", vector_store_id: "v", blob_name: "b" },
  { ...base, id: "4", file_name: "stuck", sync_status: "processing", uploaded_at: "2026-10-04T00:00:00Z", openai_file_id: "f4", vector_store_id: "v", blob_name: "b" },
  { ...base, id: "5", file_name: "untagged", sync_status: "ready", openai_file_id: "f5", vector_store_id: "v", blob_name: "b", metadata: {}, audience_status: "unclassified" },
  { ...base, id: "6", file_name: "old", sync_status: "ready", openai_file_id: "f6", vector_store_id: "v", blob_name: "b", outdated: true, outdated_note: "hay versión nueva" },
]
const report = buildHealthReport(files, { audienceEnabled: true, now: Date.parse("2026-10-05T00:00:00Z") })
assert.equal(report.totals.documents, 6)
assert.equal(report.totals.ready, 3)
assert.equal(report.totals.failed, 1)
assert.equal(report.totals.notIndexed, 1)
assert.equal(report.totals.processing, 1)
const kinds = Object.fromEntries(report.issues.map((i) => [i.fileId + i.kind, i]))
assert.ok(kinds["2no_file"] && kinds["2no_file"].actions.join() === "delete")
assert.ok(kinds["3failed"].detail.includes("vacío") && kinds["3failed"].actions.includes("retry"))
assert.ok(kinds["4stuck"])
assert.ok(kinds["5untagged"].detail.includes("tipo"))
assert.ok(kinds["6outdated"].detail.includes("versión nueva"))
assert.equal(report.untaggedAudience, 1)
assert.equal(buildHealthReport(files, { audienceEnabled: false }).untaggedAudience, 0)
assert.ok(explainSyncError(null).length > 0)
console.log("health report: ok")

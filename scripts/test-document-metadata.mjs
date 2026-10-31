// Astra metadata proposals.   node scripts/test-document-metadata.mjs
import assert from "node:assert/strict"
import { register } from "node:module"

register(new URL("./resolve-alias.mjs", import.meta.url).href)

const { extractDocumentExcerpt } = await import("../lib/knowledge/extract-text.ts")
const {
  applyMetadataProposal,
  audienceForSavedLabels,
  hasMetadataGap,
  proposalFromReading,
} = await import("../lib/knowledge/document-metadata.ts")

const options = ["Partners", "Vendors", "Members"]

const sector = proposalFromReading({
  nombre: "Field office policy",
  tipo: "policy",
  fuente: ["Publisher", "Publisher"],
  contexto: "  Covers the field offices.  ",
  reading: {
    knownProfiles: ["Partners"],
    limitedToKnownProfiles: false,
    otherAudiences: ["Field offices", "general"],
    reason: "The text names field offices.",
  },
  options,
  knownLabels: [...options, "Field offices"],
  knownTypes: ["Policy", "Notice"],
})
assert.equal(sector.tipo, "Policy")
assert.deepEqual(sector.audiencia, ["Field offices", "Partners"])
assert.deepEqual(sector.audienciaFiltro, [])
assert.equal(sector.audiencia.includes("Partners"), true)
assert.equal(sector.audiencia.some((label) => label === "Vendors"), false)
assert.deepEqual(sector.fuente, ["Publisher"])
assert.equal(sector.contexto, "Covers the field offices.")

const banks = proposalFromReading({
  nombre: "",
  tipo: "Notice",
  fuente: ["Official gazette"],
  contexto: "Notice for partners only.",
  reading: {
    knownProfiles: ["Partners"],
    limitedToKnownProfiles: true,
    otherAudiences: [],
    reason: "Partners only.",
  },
  options,
  knownLabels: options,
  knownTypes: ["Notice"],
})
assert.deepEqual(banks.audiencia, ["Partners"])
assert.deepEqual(banks.audienciaFiltro, ["Partners"])

const current = {
  fileName: "policy.pdf",
  metadata: { type_tag: "Policy", target_tag: ["Field offices"], entity_tag: [], context: "" },
}
const filled = applyMetadataProposal(current, {
  ...sector,
  tipo: "Manual",
  audiencia: ["Partners"],
  fuente: ["Publisher"],
  contexto: "Short summary.",
})
assert.deepEqual(filled.wrote, ["fuente", "contexto"])
assert.equal(filled.fileName, "policy.pdf")
assert.equal(filled.metadata.type_tag, "Policy")
assert.deepEqual(filled.metadata.target_tag, ["Field offices"])
assert.deepEqual(filled.metadata.entity_tag, ["Publisher"])
assert.equal(filled.metadata.context, "Short summary.")

const named = applyMetadataProposal(
  { fileName: "  ", metadata: null },
  { ...banks, nombre: "Notice 1" }
)
assert.deepEqual(named.wrote, ["nombre", "tipo", "audiencia", "fuente", "contexto"])
assert.equal(named.fileName, "Notice 1")

assert.equal(hasMetadataGap({ file_name: "a.pdf", metadata: filled.metadata }), false)
assert.equal(hasMetadataGap({ file_name: "a.pdf", metadata: { type_tag: "Policy" } }), true)

assert.deepEqual(
  audienceForSavedLabels(["Field offices"], options, sector),
  []
)
assert.equal(
  audienceForSavedLabels(["Partners"], options, null),
  null
)

const text = await extractDocumentExcerpt(
  "note.html",
  new TextEncoder().encode("<p>This note covers the field offices.</p>"),
  "html"
)
assert.match(text, /field offices/)
assert.equal(text.includes("<p>"), false)

const empty = await extractDocumentExcerpt("vacio.txt", new Uint8Array(), "txt")
assert.equal(empty, "")

console.log("document metadata: ok")

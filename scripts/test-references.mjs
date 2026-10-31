// Unit checks for the "Referencias" parser used by the chat UI.
//   node scripts/test-references.mjs
import assert from "node:assert/strict"
import { describeReference, linkCitations, splitReferences, stripFileCiteMarkers } from "../lib/chat/references.ts"

const plain = splitReferences("El valor es X [1] y se cita [2].\n\nReferencias:\n\n[1] Manual de operaciones, (páginas 5-12)\n   - Sección 5: Definiciones\n[2] Guia interna.pdf, (páginas 3-4)\n")
assert.equal(plain.body, "El valor es X [1] y se cita [2].")
assert.equal(plain.references.length, 2)
assert.deepEqual(describeReference(plain.references[0].text), { title: "Manual de operaciones", pages: "5–12", details: ["Sección 5: Definiciones"] })

// The model sometimes writes "**Referencias: **" (space inside the bold).
const bold = splitReferences("Texto [1].\n\n**Referencias: **\n\n[1] Manual de operaciones, sección 2 (página no indicada).\n\n[2] Guia interna (páginas no indicadas).")
assert.equal(bold.body, "Texto [1].")
assert.deepEqual(bold.references.map((r) => r.number), [1, 2])

// formatReferences() turns "**Referencias:**" into "**Referencias:\n **".
const split = splitReferences("Texto [1].\n\n**Referencias:\n **\n\n[1] Manual A, (sección 3).\n\n[2] Guia B.")
assert.equal(split.body, "Texto [1].")
assert.equal(split.references.length, 2)

assert.equal(splitReferences("## Referencias\n[1] A\n[2] B, (páginas 1)").references.length, 2)
assert.equal(splitReferences("**Referencias:**\n- [1] Doc uno\n- [2] Doc dos").references.length, 2)
assert.equal(splitReferences("Sin referencias [1] solo.").references.length, 0)
// A sentence that merely starts with the word is not a reference section.
const prose = "Intro\n\nFuentes de financiamiento permitidas:\n- depósitos\n- bonos"
assert.equal(splitReferences(prose).body, prose)

assert.equal(linkCitations("a [1] b [2](x)"), "a [1](#cite-1) b [2](x)")

assert.equal(
  stripFileCiteMarkers("El valor es X filecite turn0file1. [1]"),
  "El valor es X. [1]"
)
assert.equal(stripFileCiteMarkers("antes fileciteturn0file2 después"), "antes después")
assert.equal(
  stripFileCiteMarkers("\uE200filecite\uE202turn0file1\uE201 fin"),
  "fin"
)
assert.equal(stripFileCiteMarkers("【turn0file3】 texto [2]"), "texto [2]")
assert.equal(
  splitReferences("Respuesta filecite turn0file0 [1].\n\nReferencias:\n\n[1] Manual A.").body,
  "Respuesta [1]."
)

console.log("references parser: ok")

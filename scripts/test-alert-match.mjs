// Unit test of the document-name matching used to suggest "this replaces that".
//   node scripts/test-alert-match.mjs
import assert from "node:assert/strict"
import { nameSimilarity, nameTokens, regulationId, supersessionCandidates } from "../lib/alert-match.ts"

assert.deepEqual(nameTokens("TEXTO COMPILADO de la Guia 21_2009-Anexos .pdf"), ["guia", "21", "anexos"])
assert.equal(regulationId("Guia 21/2009 Notas de caracter general"), "21/2009")
assert.equal(regulationId("TEXTO COMPILADO de la Guia 34:2010-Anexos"), "34/2010")
assert.equal(regulationId("Manual de operaciones internas"), null)

const cat = "Guia 21/2009 Notas de caracter general que describen el metodo de calculo del indice"
assert.ok(nameSimilarity(cat, "Guia 21/2009 (actualizada 2025) Notas de caracter general que describen el metodo de calculo del indice") >= 0.6)
assert.ok(nameSimilarity(cat, "TEXTO COMPILADO de la Guia 21:2009-Anexos .pdf") >= 0.6, "same number/year id counts")
assert.ok(nameSimilarity(cat, "Guia 34/2010 Reglas de ejemplo") < 0.6)
assert.ok(nameSimilarity(cat, "Informe anual de resultados") < 0.3)
assert.equal(nameSimilarity("", "Guia 1/2005"), 0)

const files = [
  { id: "a", file_name: cat },
  { id: "b", file_name: "Guia 34/2010 Reglas de ejemplo" },
  { id: "c", file_name: "Guia 21/2009 vieja", superseded_by: "z" },
]
const found = supersessionCandidates({ id: "n", file_name: "Guia 21/2009 versión 2026 Notas de caracter general que describen el metodo de calculo del indice" }, files)
assert.deepEqual(found.map((f) => f.file.id), ["a"], "unrelated and already replaced documents are skipped")
assert.deepEqual(supersessionCandidates(files[0], files), [], "a document never replaces itself")
console.log("alert matching: ok")

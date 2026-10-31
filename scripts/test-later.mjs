// Later review: language, obligation tables, library match, public-source parsers.
//   node scripts/test-later.mjs
import assert from "node:assert/strict"

import { languageInstruction, questionLanguage } from "../lib/chat/language.ts"
import {
  extractObligationsFromAnswer,
  obligationsToMarkdown,
  obligationsToTsv,
  parseObligationPayload,
} from "../lib/chat/obligations.ts"
import { isAlreadyInLibrary } from "../lib/watch/library-match.ts"
import {
  dofPublicUrl,
  isWatchedOrgan,
  parseBanxicoConsultations,
  parseCnbvDocuments,
  watchedDofNotes,
} from "../lib/watch/sources.ts"

assert.equal(questionLanguage("¿Cuál es el plazo para presentar el informe?"), "es")
assert.equal(questionLanguage("hola"), "es")
assert.equal(
  questionLanguage("What is the deadline for the capital requirement?"),
  "en"
)
assert.equal(questionLanguage("What are the sanctions for late filing?"), "en")
assert.equal(languageInstruction("es"), "")
assert.match(languageInstruction("en"), /inglés/)

const table = `
| Obligación | Plazo | Sanción |
| --- | --- | --- |
| Presentar el informe anual | 15 días hábiles | Multa de 1,000 a 5,000 |
| Conservar expedientes | 10 años | — |
`
const rows = extractObligationsFromAnswer(table)
assert.equal(rows.length, 2)
assert.equal(rows[0].obligation, "Presentar el informe anual")
assert.equal(rows[0].deadline, "15 días hábiles")
assert.equal(rows[0].sanction, "Multa de 1,000 a 5,000")
assert.match(obligationsToMarkdown(rows), /\| Obligación \| Plazo \| Sanción \|/)
assert.match(obligationsToTsv(rows), /Presentar el informe anual\t15 días hábiles/)
assert.deepEqual(extractObligationsFromAnswer("No hay tabla aquí."), [])
assert.equal(
  parseObligationPayload(
    JSON.stringify({
      rows: [{ obligation: "Avisar", deadline: "", sanction: "Multa" }],
    })
  )[0].obligation,
  "Avisar"
)
assert.deepEqual(parseObligationPayload("nope"), [])

const prose = extractObligationsFromAnswer(
  "Obligación: Reportar operaciones. Plazo: 30 días. Sanción: Multa de 500."
)
assert.equal(prose.length, 1)
assert.equal(prose[0].deadline, "30 días.")

assert.equal(isWatchedOrgan("BANCO DE MEXICO"), true)
assert.equal(isWatchedOrgan("COMISIÓN NACIONAL BANCARIA Y DE VALORES"), true)
assert.equal(isWatchedOrgan("SECRETARÍA DE HACIENDA Y CRÉDITO PÚBLICO"), true)
assert.equal(isWatchedOrgan("SECRETARIA DE MARINA"), false)
assert.equal(
  watchedDofNotes([
    { codNota: 1, codOrgaDos: "BANCO DE MEXICO" },
    { codNota: 2, codOrgaDos: "SECRETARIA DE MARINA" },
  ]).length,
  1
)
assert.equal(
  dofPublicUrl(5802196, "27-10-2026"),
  "https://www.dof.gob.mx/nota_detalle.php?codigo=5802196&fecha=27/10/2026"
)

const cnbv = parseCnbvDocuments(`
<h2>Guías CNBV para la autorización</h2>
<a href="/cnbv/documentos/guias-cnbv-para-la-autorizacion">Continuar leyendo</a>
`)
assert.equal(cnbv.length, 1)
assert.equal(cnbv[0].source, "cnbv")
assert.equal(
  cnbv[0].url,
  "https://www.gob.mx/cnbv/documentos/guias-cnbv-para-la-autorizacion"
)

const banxico = parseBanxicoConsultations(`
<li style="font-size: 16px;">PROYECTO DE REGLAS PARA CAMARAS DE COMPENSACION<br/>
<span>Cerrado el 24/09/2026</span>
<a class="button" href="downloadFile?fileId={ABC-1}">Plan de consulta</a>
<a class="button" href="downloadFile?fileId={DEF-2}">Proyecto de disposiciones</a>
</li>
`)
assert.equal(banxico.length, 1)
assert.equal(banxico[0].externalId, "DEF-2")
assert.equal(banxico[0].publishedOn, "2026-09-24")
assert.match(banxico[0].url, /ConsultaRegulacionWeb\/downloadFile\?fileId=\{DEF-2\}/)

assert.equal(
  isAlreadyInLibrary(
    "Example publication",
    ["Example publication.pdf"]
  ),
  true
)
assert.equal(
  isAlreadyInLibrary("Tasas de interés", ["Ley de Instituciones de Crédito.pdf"]),
  false
)

console.log("later review: ok")

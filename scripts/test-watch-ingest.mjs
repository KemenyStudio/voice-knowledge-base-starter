// Vigilancia ingest helpers: official-file selection and the scan summary.
//   node scripts/test-watch-ingest.mjs
import assert from "node:assert/strict"

import { isAlreadyInLibrary } from "../lib/watch/library-match.ts"
import {
  dofDocUrl,
  extractOfficialDownloads,
  isAllowedOfficialUrl,
  libraryFileName,
  preferReadableOfficial,
  sniffOfficial,
  usableHtmlDocument,
} from "../lib/watch/official-file.ts"
import { watchResultNote } from "../lib/watch/summary.ts"

assert.equal(isAllowedOfficialUrl("https://www.banxico.org.mx/ConsultaRegulacionWeb/downloadFile?fileId=%7B1%7D"), true)
assert.equal(isAllowedOfficialUrl("https://sidof.segob.gob.mx/dof/sidof/documentos/doc/5802195"), true)
assert.equal(isAllowedOfficialUrl("http://sidof.segob.gob.mx/dof/sidof/documentos/doc/1"), false)
assert.equal(isAllowedOfficialUrl("https://user:pw@www.gob.mx/file.pdf"), false)
assert.equal(isAllowedOfficialUrl("https://example.com/file.pdf"), false)

assert.equal(
  dofDocUrl("5802195"),
  "https://sidof.segob.gob.mx/dof/sidof/documentos/doc/5802195"
)
assert.equal(dofDocUrl("nota"), null)

assert.equal(sniffOfficial(Buffer.from("%PDF-1.7\n"), ""), "pdf")
assert.equal(sniffOfficial(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]), ""), "doc")
assert.equal(sniffOfficial(Buffer.from([0x50, 0x4b, 0x03, 0x04]), "file.docx"), "docx")
assert.equal(sniffOfficial(Buffer.from([0x50, 0x4b, 0x03, 0x04]), "random.zip"), null)

const html = `<p>${"texto oficial ".repeat(40)}</p>`
assert.equal(usableHtmlDocument(Buffer.from(html)), true)
assert.equal(
  usableHtmlDocument(Buffer.from("<title>Challenge Validation</title><p>aaaa</p>")),
  false
)

const links = extractOfficialDownloads(
  '<a href="/cms/uploads/nota.pdf">PDF</a><a href="https://example.com/otro.pdf">no</a><a href="https://www.gob.mx/cms/archivo.docx">Word</a>',
  "https://www.gob.mx/cnbv/documentos/ejemplo"
)
assert.deepEqual(links, [
  "https://www.gob.mx/cms/uploads/nota.pdf",
  "https://www.gob.mx/cms/archivo.docx",
])

const pdf = Buffer.from("%PDF-1.7")
assert.equal(
  preferReadableOfficial({ binary: { bytes: pdf, ext: "pdf" }, html: "<p>x</p>" })?.ext,
  "pdf"
)
const doc = Buffer.from([0xd0, 0xcf, 0x11, 0xe0])
assert.equal(
  preferReadableOfficial({
    binary: { bytes: doc, ext: "doc" },
    html: `<p>${"disposicion ".repeat(40)}</p>`,
  })?.ext,
  "html"
)
assert.equal(
  preferReadableOfficial({ binary: { bytes: doc, ext: "doc" }, html: null })?.ext,
  "doc"
)

assert.equal(
  libraryFileName("Tipo de cambio para solventar obligaciones", "html"),
  "Tipo de cambio para solventar obligaciones.html"
)
assert.equal(libraryFileName("Informe.pdf", "pdf"), "Informe.pdf")

assert.equal(
  isAlreadyInLibrary("Tasas", ["Tasas.pdf"]),
  true
)
assert.equal(
  isAlreadyInLibrary("Ley", ["Ley de Instituciones de Crédito.pdf"]),
  false
)

assert.match(
  watchResultNote({ skippedScan: false, ingested: 2, already: 1, failed: 0, pending: 0 }),
  /Se agregaron 2 documentos/
)
assert.match(
  watchResultNote({ skippedScan: false, ingested: 2, already: 1, failed: 0, pending: 0 }),
  /no se reemplazó/
)
assert.equal(
  watchResultNote({ skippedScan: true, ingested: 0, already: 0, failed: 0, pending: 1 }),
  "La revisión acaba de correr. Estas son las propuestas vigentes."
)
assert.match(
  watchResultNote({ skippedScan: false, ingested: 0, already: 0, failed: 1, pending: 3 }),
  /Vuelve a buscar/
)

console.log("watch ingest: ok")

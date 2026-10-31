// Unit checks for the pre-upload index inspection.  node scripts/test-index-readiness.mjs
import assert from "node:assert/strict"
import { register } from "node:module"
import { strToU8, zipSync } from "fflate"

register(new URL("./resolve-alias.mjs", import.meta.url).href)

const { healthForIndexedText, shouldReplaceIndex } = await import("../lib/knowledge/index-text.ts")
const { inspectFileBytes, scoreIndexHealth } = await import("../lib/knowledge/index-readiness.ts")

const plenty = "Artículo sobre capital y liquidez de las instituciones. ".repeat(30)

const good = scoreIndexHealth({
  sizeBytes: 20_000,
  kind: "text",
  textChars: plenty.length,
  pages: 4,
  scanRatio: 0,
  passwordProtected: false,
  extractable: true,
})
assert.equal(good.verdict, "good")
assert.equal(good.canUpload, true)
assert.ok(good.score >= 80)
assert.equal(good.reasons.length, 0)

const empty = scoreIndexHealth({
  sizeBytes: 0,
  kind: "pdf",
  textChars: 0,
  pages: null,
  scanRatio: 0,
  passwordProtected: false,
  extractable: false,
})
assert.equal(empty.canUpload, false)
assert.ok(empty.reasons[0].includes("vacío"))

const locked = scoreIndexHealth({
  sizeBytes: 50_000,
  kind: "pdf",
  textChars: 0,
  pages: null,
  scanRatio: 0,
  passwordProtected: true,
  extractable: false,
})
assert.equal(locked.canUpload, true)
assert.ok(locked.reasons[0].includes("contraseña"))
assert.ok(locked.score < 50)

const scan = scoreIndexHealth({
  sizeBytes: 2_000_000,
  kind: "pdf",
  textChars: 12,
  pages: 8,
  scanRatio: 1,
  passwordProtected: false,
  extractable: true,
})
assert.equal(scan.verdict, "review")
assert.equal(scan.canUpload, true)
assert.ok(scan.reasons.some((reason) => reason.includes("OCR") || reason.includes("escaneo")))

const huge = scoreIndexHealth({
  sizeBytes: 12 * 1024 * 1024,
  kind: "pdf",
  textChars: 8_000,
  pages: 40,
  scanRatio: 0,
  passwordProtected: false,
  extractable: true,
})
assert.equal(huge.verdict, "review")
assert.equal(huge.canUpload, true)
assert.ok(huge.reasons.some((reason) => reason.includes("10 MB")))

const oldDoc = scoreIndexHealth({
  sizeBytes: 40_000,
  kind: "doc",
  textChars: 0,
  pages: null,
  scanRatio: 0,
  passwordProtected: false,
  extractable: false,
})
assert.ok(oldDoc.reasons[0].includes(".doc"))

const textFile = await inspectFileBytes("circular.txt", new TextEncoder().encode(plenty))
assert.equal(textFile.verdict, "good")
assert.equal(textFile.canUpload, true)

const blank = await inspectFileBytes("vacio.txt", new Uint8Array())
assert.equal(blank.canUpload, false)

const html = await inspectFileBytes(
  "pagina.html",
  new TextEncoder().encode("<html><body><p></p></body></html>")
)
assert.equal(html.verdict, "review")
assert.ok(html.reasons.some((reason) => reason.includes("texto")))

const docx = zipSync({
  "word/document.xml": strToU8(
    `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${plenty}</w:t></w:r></w:p></w:body></w:document>`
  ),
})
const word = await inspectFileBytes("manual.docx", docx)
assert.equal(word.verdict, "good", word.reasons.join(" | "))

function minimalPdf(text) {
  const stream = `BT /F1 12 Tf 40 80 Td (${text}) Tj ET`
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Count 1 /Kids [3 0 R] >>endobj\n",
    `3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 8000 8000] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n`,
    `4 0 obj<< /Length ${stream.length} >>stream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  ]
  let body = "%PDF-1.4\n"
  const offsets = [0]
  for (const object of objects) {
    offsets.push(body.length)
    body += object
  }
  const xrefAt = body.length
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let index = 1; index < offsets.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`
  }
  const trailer = `trailer<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF`
  return new TextEncoder().encode(body + xref + trailer)
}

const pdf = await inspectFileBytes("ley.pdf", minimalPdf("Texto de una ley con articulos suficientes para buscar."))
assert.equal(pdf.verdict, "review")
assert.ok(pdf.reasons.some((reason) => reason.toLowerCase().includes("corto")))
assert.equal(pdf.canUpload, true)

const titled = await inspectFileBytes(
  "Ley de Instituciones de Crédito",
  minimalPdf(Array.from({ length: 40 }, () => "Articulo sobre capital y liquidez. ").join(" ")),
  "pdf"
)
assert.ok((titled.score ?? 0) > 35, titled.reasons.join(" | "))
assert.equal(titled.verdict, "good")

const untitled = await inspectFileBytes(
  "Ley de Instituciones de Crédito",
  minimalPdf(Array.from({ length: 40 }, () => "Articulo sobre capital y liquidez. ").join(" "))
)
assert.equal(untitled.score, 35)

const gained = healthForIndexedText({
  sizeBytes: 80_000,
  fileType: "pdf",
  text: "Artículo de la ley. ".repeat(40),
  pages: 3,
})
assert.equal(shouldReplaceIndex(35, gained, "Artículo de la ley. ".repeat(40)), true)
assert.equal(shouldReplaceIndex(gained.score, gained, "Artículo de la ley. ".repeat(40)), false)
assert.equal(shouldReplaceIndex(35, gained, "   "), false)

const longPdf = await inspectFileBytes(
  "ley-larga.pdf",
  minimalPdf(
    Array.from({ length: 20 }, () => "Articulo sobre capital y liquidez. ").join(") Tj (")
  )
)
assert.equal(longPdf.verdict, "good", longPdf.reasons.join(" | "))
assert.ok(longPdf.score >= 80)

console.log("index readiness: ok")

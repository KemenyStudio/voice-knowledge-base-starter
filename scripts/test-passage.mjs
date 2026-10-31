// Unit checks for Fuentes passage formatting and citation location.
//   node --import ./scripts/register-ts-alias.mjs scripts/test-passage.mjs
import assert from "node:assert/strict"

import {
  formatPassage,
  locationCaption,
  locationFromMetadata,
  questionWithPassage,
  readPassage,
} from "../lib/chat/passage.ts"

const formatted = formatPassage(
  "Artículo 4.- Las instituciones de crédito deberán\ncalcular el CAT conforme a la fórmula del\nAnexo 1.\nI. El cálculo incluye comisiones.\nII. Se excluyen impuestos.\n\nArtículo 5o.- Se publica en el Diario Oficial."
)
assert.equal(formatted.length, 2)
assert.equal(formatted[0].kind, "article")
if (formatted[0].kind === "article") {
  assert.equal(formatted[0].label, "Artículo 4")
  assert.deepEqual(formatted[0].paragraphs, [
    "Las instituciones de crédito deberán calcular el CAT conforme a la fórmula del Anexo 1.",
    "I. El cálculo incluye comisiones.",
    "II. Se excluyen impuestos.",
  ])
}
assert.equal(formatted[1].kind, "article")
if (formatted[1].kind === "article") {
  assert.equal(formatted[1].label, "Artículo 5o")
  assert.deepEqual(formatted[1].paragraphs, ["Se publica en el Diario Oficial."])
}

const glued = formatPassage(
  "Disposiciones generales. Artículo 2. Para efectos de estas reglas se entiende por crédito."
)
assert.equal(glued.length, 2)
assert.equal(glued[0].kind, "paragraph")
assert.equal(glued[1].kind, "article")
if (glued[1].kind === "article") {
  assert.equal(glued[1].label, "Artículo 2")
  assert.deepEqual(glued[1].paragraphs, ["Para efectos de estas reglas se entiende por crédito."])
}

const wrapped = formatPassage("Las institu-\nciones deberán informar.")
assert.deepEqual(wrapped, [{ kind: "paragraph", text: "Las instituciones deberán informar." }])

const prose = formatPassage("Un solo párrafo sin saltos ni artículos.")
assert.deepEqual(prose, [{ kind: "paragraph", text: "Un solo párrafo sin saltos ni artículos." }])

const fromPage = locationFromMetadata({ page: 12, file_name: "circular.pdf" })
assert.deepEqual(fromPage, { page: "12", article: null, fileLocation: null })
assert.equal(locationCaption(fromPage), "Página 12")

const range = locationFromMetadata({ start_page: 5, end_page: "12", articulo: "Artículo 5 Bis" })
assert.equal(range.page, "5–12")
assert.equal(range.article, "5 Bis")
assert.equal(locationCaption(range), "Páginas 5–12 · Artículo 5 Bis")

const located = locationFromMetadata(
  { file_location: "Anexo 1", section: "ignorado porque ya hay location" },
  { title: "Circular 14/2009", filename: "circular.pdf" }
)
assert.equal(located.fileLocation, "Anexo 1")
assert.equal(located.page, null)
assert.equal(
  locationCaption(located),
  "La cita no incluye la página · Ubicación: Anexo 1"
)

const filenameIsNotAPlace = locationFromMetadata(
  { location: "Circular 14/2009.pdf" },
  { filename: "Circular 14/2009.pdf" }
)
assert.equal(filenameIsNotAPlace.fileLocation, null)

const invented = locationFromMetadata({
  file_name: "ley.pdf",
  type_tag: "ley",
  score: 0.8,
  index: 12,
})
assert.deepEqual(invented, { page: null, article: null, fileLocation: null })
assert.equal(locationCaption(invented), "La cita no incluye la página")

const mentioned = formatPassage("El artículo 9 remite a la página 3 del anexo, sin ser un encabezado.")
assert.equal(mentioned.length, 1)
assert.equal(mentioned[0].kind, "paragraph")
assert.equal(locationFromMetadata({}).page, null)

const asked = questionWithPassage("¿A quién aplica?", {
  title: "Circular 14/2009",
  text: "Artículo 4.- Aplica a los bancos.",
  location: invented,
})
assert.match(asked, /^¿A quién aplica\?/)
assert.match(asked, /La cita no incluye la página/)
assert.match(asked, /Artículo 4\.- Aplica a los bancos\./)
assert.doesNotMatch(asked, /Página \d/)

const withPage = questionWithPassage("¿Qué plazo da?", {
  title: "Ley",
  text: "El plazo es de 30 días.",
  location: { page: "8", article: null, fileLocation: null },
})
assert.match(withPage, /Página 8/)
assert.doesNotMatch(withPage, /La cita no incluye la página/)

assert.equal(readPassage({ title: "  Ley ", text: " texto ", location: { page: "2" } })?.location.page, "2")
assert.equal(readPassage({ title: "", text: "x" }), null)
assert.equal(readPassage(null), null)

console.log("passage formatter: ok")

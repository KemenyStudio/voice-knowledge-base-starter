/**
 * Isolated corpus for the local computer-use check. It is not the team library.
 * One passage holds the known fact (6249). The others are distractors.
 */
export const FIXTURE_QUESTION =
  "¿Cuál es el código de recogida de la prueba aislada?"

export const FIXTURE_FACT = "6249"
export const FIXTURE_DISTRACTOR = "1001"

export const FIXTURE_PASSAGES = [
  {
    title: "Prueba aislada CU-1842",
    text: "El código de recogida de la prueba aislada es 6249. El casillero de esa misma prueba es Locker 18.",
  },
  {
    title: "Archivo de ejemplo",
    text: "El código de recogida de la prueba de archivo es 1001. Ese archivo no es la prueba local CU-1842.",
  },
  {
    title: "Nota de vigencia",
    text: "El manual de ejemplo indica una vigencia de 2020 y no contiene un código de recogida.",
  },
]

const STOP = new Set([
  "el",
  "la",
  "los",
  "las",
  "de",
  "del",
  "al",
  "y",
  "en",
  "es",
  "un",
  "una",
  "que",
  "cual",
  "por",
  "para",
  "con",
  "su",
  "sus",
  "se",
  "lo",
])

function terms(value) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .split(/[^a-z0-9]+/)
    .filter((term) => term.length > 2 && !STOP.has(term))
}

/** Best matching passage from the isolated corpus, or null when nothing overlaps. */
export function rankFixturePassages(question) {
  const wanted = terms(question)
  if (wanted.length === 0) return null
  let best = null
  let bestScore = 0
  for (const passage of FIXTURE_PASSAGES) {
    const folded = `${passage.title} ${passage.text}`
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
    const score = wanted.filter((term) => folded.includes(term)).length
    if (score > bestScore) {
      best = passage
      bestScore = score
    }
  }
  return best
}

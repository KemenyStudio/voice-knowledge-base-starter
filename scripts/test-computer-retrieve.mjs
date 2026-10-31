import assert from "node:assert/strict"

import {
  FIXTURE_DISTRACTOR,
  FIXTURE_FACT,
  FIXTURE_QUESTION,
  rankFixturePassages,
} from "../lib/computer/fixture-corpus.mjs"

const hit = rankFixturePassages(FIXTURE_QUESTION)
assert.ok(hit, "expected a passage")
assert.equal(hit.text.includes(FIXTURE_FACT), true)
assert.equal(hit.text.includes(FIXTURE_DISTRACTOR), false)
assert.equal(hit.title, "Prueba aislada CU-1842")

const other = rankFixturePassages("¿Cuál es el código de recogida de la prueba de archivo?")
assert.ok(other)
assert.equal(other.text.includes(FIXTURE_DISTRACTOR), true)
assert.equal(other.text.includes(FIXTURE_FACT), false)

assert.equal(rankFixturePassages("hola"), null)

console.log("computer retrieve: 3 checks passed")

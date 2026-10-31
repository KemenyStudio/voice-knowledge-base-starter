// Unit checks for audience helpers.   node scripts/test-audience.mjs
import assert from "node:assert/strict"
import { audienceAttributes, audienceFilter, normalizeAliases, normalizeOptions, tagsToAudience, visibleDocumentCount, slugify } from "../lib/audience.ts"

const options = ["Grupo A", "Grupo B", "Cliente interno", "Cliente externo", "Proveedores"]
assert.equal(slugify("Grupo A"), "grupo_a")
assert.deepEqual(normalizeOptions([" Grupo A ", "grupo a", "", 3, "Grupo B"]), ["Grupo A", "Grupo B"])
assert.equal(normalizeOptions(Array.from({ length: 20 }, (_, i) => `Tipo ${i}`)).length, 8)

assert.deepEqual(tagsToAudience(["Grupo A", "Grupo B"], options), ["Grupo A", "Grupo B"])
assert.deepEqual(tagsToAudience(["Cliente"], options), ["Cliente interno", "Cliente externo"])
assert.equal(tagsToAudience(["Grupo A", "Desconocido"], options), null)
assert.equal(tagsToAudience(["Socios"], options), null)
assert.equal(tagsToAudience([], options), null)
assert.deepEqual(
  tagsToAudience(["Socios", "Grupo A"], [...options, "Socio oro", "Socio plata"], normalizeAliases({ socios: ["Socio oro", "Socio plata"] })),
  ["Grupo A", "Socio oro", "Socio plata"]
)
assert.deepEqual(normalizeAliases(null), {})
assert.deepEqual(normalizeAliases({ Partners: ["Partner gold", "Partner silver"] }).partners, ["Partner gold", "Partner silver"])

assert.deepEqual(audienceAttributes(options, []), {})
assert.deepEqual(audienceAttributes(options, ["Grupo A", "Grupo B"]), { excl_cliente_interno: true, excl_cliente_externo: true, excl_proveedores: true })
assert.deepEqual(audienceAttributes(options, ["Algo que no existe"]), {})
assert.deepEqual(audienceFilter("Grupo A"), { type: "ne", key: "excl_grupo_a", value: true })

const docs = [{ audience: [] }, { audience: ["Grupo A"] }, { audience: ["Grupo B"] }, { audience: null }]
assert.equal(visibleDocumentCount(docs, options, "Grupo A"), 3)
assert.equal(visibleDocumentCount(docs, options, "Grupo B"), 3)
assert.equal(visibleDocumentCount(docs, options, "Proveedores"), 2)
console.log("audience helpers: ok")

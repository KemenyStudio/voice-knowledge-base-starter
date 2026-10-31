// Unit checks for audience labels.   node scripts/test-audience-label.mjs
import assert from "node:assert/strict"
import { register } from "node:module"

register(new URL("./resolve-alias.mjs", import.meta.url).href)

const { needsAudienceLabel, resolveAudienceLabel } = await import(
  "../lib/knowledge/audience-label.ts"
)

const options = [
  "Partners",
  "Vendors",
  "Members",
  "Group north",
  "Group south",
  "Platforms",
  "Funds",
  "Holdings",
]

const banks = resolveAudienceLabel(options, {
  knownProfiles: ["partners", "Vendors"],
  limitedToKnownProfiles: true,
  otherAudiences: [],
  reason: "Partners and vendors only.",
})
assert.deepEqual(banks.audience, ["Partners", "Vendors"])
assert.deepEqual(banks.labels, ["Partners", "Vendors"])

const exchange = resolveAudienceLabel(options, {
  knownProfiles: ["Vendors"],
  limitedToKnownProfiles: false,
  otherAudiences: ["Field offices", "field offices", "general"],
  reason: "Also applies to field offices.",
})
assert.deepEqual(exchange.audience, [])
assert.deepEqual(exchange.labels, ["Field offices", "Vendors"])

const statute = resolveAudienceLabel(options, {
  knownProfiles: ["Partners"],
  limitedToKnownProfiles: true,
  otherAudiences: ["Central office"],
  reason: "Names a different group.",
})
assert.deepEqual(statute.audience, [])
assert.deepEqual(statute.labels, ["Central office", "Partners"])

const empty = resolveAudienceLabel(options, {
  knownProfiles: [],
  limitedToKnownProfiles: false,
  otherAudiences: ["todos", "na"],
  reason: "",
})
assert.equal(empty, null)

assert.equal(
  needsAudienceLabel({
    audience_status: "confirmed",
    sync_status: "ready",
    vector_store_id: "vs",
    metadata: { target_tag: [] },
  }),
  true
)
assert.equal(
  needsAudienceLabel({
    audience_status: "confirmed",
    sync_status: "ready",
    vector_store_id: "vs",
    metadata: { target_tag: ["Partners"] },
  }),
  false
)
assert.equal(
  needsAudienceLabel({
    audience_status: "unclassified",
    sync_status: "ready",
    vector_store_id: "vs",
    metadata: { target_tag: ["Partners"] },
  }),
  true
)
assert.equal(
  needsAudienceLabel({
    audience_status: "unclassified",
    sync_status: "failed",
    vector_store_id: "vs",
    metadata: { target_tag: [] },
  }),
  false
)

console.log("audience labels: ok")

// Retrieval settings and the separate web-search intent.
//   node scripts/test-retrieval.mjs
import assert from "node:assert/strict"

import {
  CHUNKING_STRATEGY,
  FILE_SEARCH_MAX_RESULTS,
  RETRIEVAL_RANKING,
  fileSearchTool,
  joinPassages,
} from "../lib/retrieval.ts"
import {
  OFFICIAL_WEB_DOMAINS,
  asksForNewerOfficialSource,
  officialWebSearchTool,
} from "../lib/official-web.ts"

const tool = fileSearchTool({ vectorStoreId: "vs_example", maxNumResults: 20 })
assert.equal(tool.type, "file_search")
assert.equal(tool.max_num_results, FILE_SEARCH_MAX_RESULTS)
assert.equal(tool.ranking_options?.ranker, "auto")
assert.equal(tool.ranking_options?.score_threshold, 0)
assert.equal(tool.ranking_options?.hybrid_search?.embedding_weight, 0.5)
assert.equal(tool.ranking_options?.hybrid_search?.text_weight, 1)
assert.ok((tool.ranking_options?.hybrid_search?.text_weight ?? 0) > 0)
assert.ok((tool.ranking_options?.hybrid_search?.embedding_weight ?? 0) > 0)
assert.equal("type" in tool && tool.type !== "web_search", true)

assert.equal(RETRIEVAL_RANKING.score_threshold, 0)
assert.equal(CHUNKING_STRATEGY.type, "static")
assert.ok(CHUNKING_STRATEGY.static.max_chunk_size_tokens >= 100)
assert.ok(CHUNKING_STRATEGY.static.max_chunk_size_tokens <= 4096)
assert.ok(
  CHUNKING_STRATEGY.static.chunk_overlap_tokens <=
    CHUNKING_STRATEGY.static.max_chunk_size_tokens / 2
)

const stored = joinPassages([
  { score: 0.9, text: "Capítulo introductorio sin la cifra." },
  { score: 0.4, text: "El capital mínimo es de noventa millones de UDI." },
])
assert.match(stored, /noventa millones/)
assert.match(stored, /Capítulo introductorio/)

assert.equal(
  asksForNewerOfficialSource(
    "¿Cuál es el capital mínimo del artículo 19 de la Ley de Instituciones de Crédito?"
  ),
  false
)
assert.equal(
  asksForNewerOfficialSource("¿Hay una fuente oficial más reciente de la Circular 9/2023?"),
  true
)
assert.equal(
  asksForNewerOfficialSource("Is there a newer official source for this circular?"),
  true
)

const web = officialWebSearchTool()
assert.equal(web.type, "web_search")
assert.equal(web.external_web_access, true)
assert.equal(web.search_context_size, "high")
assert.equal(web.user_location.country, "MX")
assert.ok(web.filters.allowed_domains.includes("banxico.org.mx"))
assert.ok(web.filters.allowed_domains.includes("dof.gob.mx"))
assert.equal(web.filters.allowed_domains.length, OFFICIAL_WEB_DOMAINS.length)
assert.equal(JSON.stringify(web).includes("file_search"), false)

console.log("retrieval settings ok")

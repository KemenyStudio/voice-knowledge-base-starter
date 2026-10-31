import type { ResponseFileSearchToolCall } from "openai/resources/responses/responses"

import { aiConfig, getOpenAI } from "../openai"
import { rankFixturePassages } from "./fixture-corpus.mjs"

interface FixturePassage {
  title: string
  text: string
}

export {
  FIXTURE_DISTRACTOR,
  FIXTURE_FACT,
  FIXTURE_PASSAGES,
  FIXTURE_QUESTION,
  rankFixturePassages,
} from "./fixture-corpus.mjs"

export interface HarnessCitation {
  number: number
  title: string
  text: string
}

export type RetrievalMode = "fixture" | "file_search"

export interface HarnessAnswer {
  answer: string
  retrieval: RetrievalMode
  citations: HarnessCitation[]
}

const STORE_ID = /^vs_[A-Za-z0-9]+$/

function redact(message: string): string {
  const keyShape = new RegExp(["sk", "[A-Za-z0-9_-]+"].join("-"), "g")
  return message.replace(keyShape, "[redacted]")
}

/**
 * file_search against one explicit store. The store id comes from the server
 * environment, never from the request.
 */
async function searchStore(storeId: string, question: string): Promise<string> {
  const response = await getOpenAI().responses.create({
    model: aiConfig.answerModel,
    reasoning: { effort: "low" },
    text: { verbosity: "low" },
    instructions:
      "Usa solo el fragmento recuperado. No agregues datos que no estén en ese fragmento.",
    input: question,
    tools: [
      {
        type: "file_search",
        vector_store_ids: [storeId],
        max_num_results: 4,
      },
    ],
    tool_choice: { type: "file_search" },
    include: ["file_search_call.results"],
    store: false,
    max_output_tokens: 400,
  })

  const results = response.output
    .filter(
      (item): item is ResponseFileSearchToolCall => item.type === "file_search_call"
    )
    .flatMap((item) => item.results ?? [])

  let best = ""
  let bestScore = -1
  for (const result of results) {
    const score = result.score ?? 0
    const text = result.text?.trim() ?? ""
    if (text && score >= bestScore) {
      best = text
      bestScore = score
    }
  }
  return best
}

function fromPassage(
  passage: FixturePassage | null,
  retrieval: RetrievalMode
): HarnessAnswer {
  if (!passage) {
    return {
      answer: "No hay un fragmento que responda esa pregunta.",
      retrieval,
      citations: [],
    }
  }
  return {
    answer: "Consulta el fragmento citado [1].",
    retrieval,
    citations: [{ number: 1, title: passage.title, text: passage.text }],
  }
}

/** Answer a question from the isolated corpus or from one dedicated vector store. */
export async function answerFixture(question: string): Promise<HarnessAnswer> {
  const store = process.env.COMPUTER_USE_VECTOR_STORE?.trim()
  if (!store) {
    return fromPassage(rankFixturePassages(question) as FixturePassage | null, "fixture")
  }
  if (!STORE_ID.test(store)) {
    throw new Error("COMPUTER_USE_VECTOR_STORE is not a vector store id")
  }
  try {
    const text = await searchStore(store, question)
    return fromPassage(text ? { title: "Fuente aislada", text } : null, "file_search")
  } catch (error) {
    const message = error instanceof Error ? error.message : "Search failed"
    throw new Error(redact(message))
  }
}

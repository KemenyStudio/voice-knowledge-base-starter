import OpenAI from "openai"

let client: OpenAI | null = null

/** Lazy singleton: importing this module never throws when the key is absent (e.g. during build). */
export function getOpenAI(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set")
    client = new OpenAI({ apiKey })
  }
  return client
}

type Effort = "none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"
type Verbosity = "low" | "medium" | "high"

const EFFORTS: Effort[] = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
]
const VERBOSITIES: Verbosity[] = ["low", "medium", "high"]

function oneOf<T extends string>(
  value: string | undefined,
  allowed: T[],
  fallback: T
): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? "", 10)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Model configuration. Everything is overridable through env so a model change
 * (or a rollback) is a config change, not a deploy.
 *
 * GPT-6 models reject `temperature` / `top_p`, so none are sent.
 * Check that the model IDs are enabled for your API key before switching.
 */
export const aiConfig = {
  answerModel: process.env.OPENAI_MODEL_ANSWER || "gpt-6-luna",
  answerEffort: oneOf<Effort>(process.env.OPENAI_REASONING_EFFORT, EFFORTS, "low"),
  answerVerbosity: oneOf<Verbosity>(
    process.env.OPENAI_TEXT_VERBOSITY,
    VERBOSITIES,
    "medium"
  ),
  // Small side tasks (follow-up suggestions, classification). Defaults to the
  // answer model with no reasoning so they add little latency.
  utilityModel:
    process.env.OPENAI_MODEL_UTILITY ||
    process.env.OPENAI_MODEL_ANSWER ||
    "gpt-6-luna",
  utilityEffort: oneOf<Effort>(
    process.env.OPENAI_UTILITY_EFFORT,
    EFFORTS,
    "none"
  ),
  // Document metadata. gpt-6-astra has no "none" effort.
  metadataModel: process.env.OPENAI_MODEL_METADATA || "gpt-6-astra",
  metadataEffort: oneOf<Effort>(
    process.env.OPENAI_METADATA_EFFORT,
    EFFORTS.filter((effort) => effort !== "none"),
    "low"
  ),
  maxOutputTokens: positiveInt(process.env.OPENAI_MAX_OUTPUT_TOKENS, 8000),
  // Floor of 20 matches the file-search guide example. Fewer chunks dropped
  // the passage that contained the cited fact. Env can raise this up to 50.
  fileSearchMaxResults: Math.min(
    Math.max(positiveInt(process.env.OPENAI_FILE_SEARCH_MAX_RESULTS, 20), 20),
    50
  ),
}

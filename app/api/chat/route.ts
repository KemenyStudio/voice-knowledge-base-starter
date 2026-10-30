import { NextRequest, NextResponse } from "next/server"
import { v4 as uuidv4 } from "uuid"
import { z } from "zod"

import { buildDefaultSystemPrompt } from "@/app/config/prompts"
import { formatReferences } from "@/app/utils/formatReferences"
import { audienceFilter, visibleDocumentCount } from "@/lib/audience"
import { requireChatbotAccess, uuidSchema } from "@/lib/auth/access"
import {
  ClarifyGate,
  clarifyInstructions,
  parseClarify,
  userContextLine,
  type Clarify,
} from "@/lib/clarify"
import {
  StoredMessage,
  getRecentMessages,
  lastResponseId,
  storeMessage,
  titleFrom,
  updateMessageMeta,
} from "@/lib/conversations"
import {
  ACTION_DOCUMENTS,
  focusFilter,
  focusInstructions,
  type FocusDocument,
} from "@/lib/document-actions"
import { generateFollowUps } from "@/lib/followups"
import { languageInstruction, questionLanguage } from "@/lib/chat/language"
import {
  locationFromMetadata,
  questionWithPassage,
  readPassage,
  type PassageContext,
} from "@/lib/chat/passage"
import {
  RESEARCH_DAILY_LIMIT,
  RESEARCH_INSTRUCTIONS,
  buildEvidence,
  countDocuments,
  evidenceInput,
  planResearch,
  runSearch,
  type EvidenceDocument,
  type SearchHit,
  type SubQuestion,
} from "@/lib/research"
import { HttpError, errorResponse } from "@/lib/http"
import { aiConfig, getOpenAI } from "@/lib/openai"
import {
  fileSearchTool,
  FOCUS_FILE_SEARCH_MAX_RESULTS,
  joinPassages,
  LIBRARY_GROUNDING,
  type ScoredPassage,
} from "@/lib/retrieval"
import {
  asksForNewerOfficialSource,
  searchNewerOfficialSource,
  type WebLookup,
} from "@/lib/web-search"
import { EMPTY_PREFS, getPrefs } from "@/lib/preferences"
import { promptNotesBlock } from "@/lib/prompt-notes"
import { getAdminClient, requireUser } from "@/lib/supabase/server"
import type { AnySupabase } from "@/lib/supabase/server"
import type { ChatCitation, ChatbotRow } from "@/types/knowledge"

import type {
  Response as OpenAIResponse,
  FileSearchTool,
  ResponseFileSearchToolCall,
  ResponseCreateParamsBase,
  ResponseInput,
  ResponseStreamEvent,
} from "openai/resources/responses/responses"

export const maxDuration = 300
export const dynamic = "force-dynamic"

const passageSchema = z.object({
  title: z.string().trim().min(1).max(300),
  text: z.string().trim().min(1).max(4000),
  location: z.object({
    page: z.string().max(40).nullable(),
    article: z.string().max(80).nullable(),
    fileLocation: z.string().max(200).nullable(),
  }),
})

const bodySchema = z.object({
  query: z
    .array(z.object({ content: z.string().trim().min(1).max(8000) }))
    .min(1),
  chatbotId: uuidSchema,
  sessionId: z.string().min(1).max(100),
  // Accepted for backwards compatibility and ignored: the server derives the
  // previous response from its own history (see lastResponseId).
  previous_response_id: z.string().nullish(),
  // true: answer as newline-delimited JSON events (see streamAnswer). Without
  // it the route returns one JSON document, as before.
  stream: z.boolean().optional(),
  // false: search every document even if the entity-type filter is on
  // (the "search all documents" retry).
  useEntityFilter: z.boolean().optional(),
  // Document action started from a source: summarize one document, or compare
  // two. The search is limited to those documents.
  // true: "Investigar a fondo". Plans several searches, shows each step and
  // writes one answer from the combined evidence. Needs stream: true.
  research: z.boolean().optional(),
  focus: z
    .object({
      action: z.enum(["summarize", "compare", "changes"]),
      fileIds: z.array(uuidSchema).min(1).max(2),
    })
    .optional(),
  // Passage the user picked in Fuentes. It is context for this question only.
  passage: passageSchema.optional(),
})

// Passages retrieved when working on specific documents.
const FOCUS_MAX_RESULTS = FOCUS_FILE_SEARCH_MAX_RESULTS

// The entity filter is skipped when it would leave fewer documents than this,
// so an over-eager classification can never starve the search.
const MIN_VISIBLE_DOCUMENTS = 3

const NO_DOCUMENTS_MESSAGE =
  "Este asistente todavía no tiene documentos. Un administrador del equipo debe subirlos en la Biblioteca antes de poder responder preguntas."

export async function POST(req: NextRequest) {
  try {
    const { supabase, user } = await requireUser()
    const body = bodySchema.parse(await req.json())
    const userMessage = body.query[body.query.length - 1].content

    const { chatbot } = await requireChatbotAccess(
      supabase,
      user.id,
      body.chatbotId,
      "member"
    )

    // Best effort bookkeeping; never blocks the answer.
    supabase
      .rpc("update_last_sign_in", { user_id: user.id })
      .then(({ error }: { error: unknown }) => {
        if (error) console.error("update_last_sign_in", error)
      })

    const history = await getRecentMessages(
      supabase,
      user.id,
      body.sessionId,
      chatbot.id
    )
    const title = history[0]?.title || titleFrom(userMessage)
    const language = questionLanguage(userMessage)
    const userMessageId = uuidv4()

    await storeMessage(supabase, {
      id: userMessageId,
      message: userMessage,
      userId: user.id,
      sessionId: body.sessionId,
      chatbotId: chatbot.id,
      role: "user",
      title,
      meta: body.passage ? { passage: body.passage } : undefined,
    })
    void incrementMessageCount(supabase, user.id)

    // Nothing to search yet: answer locally instead of paying for an empty search.
    const { data: documents, error: countError } = await supabase
      .from("files")
      .select("audience")
      .eq("chatbot_id", chatbot.id)
    if (countError) throw countError

    if (!documents?.length) {
      return respondLocally(
        supabase,
        chatbot,
        user.id,
        body.sessionId,
        title,
        userMessageId
      )
    }
    if (!chatbot.vector_store_id) {
      throw new HttpError(
        409,
        "This chatbot has documents but no search index yet. Ask an admin to re-index them from the Library."
      )
    }

    let focusDocs: FocusDocument[] = []
    let focusAction: NonNullable<typeof body.focus>["action"] | null = null
    if (body.focus) {
      const ids = Array.from(new Set(body.focus.fileIds))
      if (ids.length !== ACTION_DOCUMENTS[body.focus.action]) {
        throw new HttpError(400, "Wrong number of documents for this action")
      }
      const { data: rows, error: focusError } = await supabase
        .from("files")
        .select("id, file_name, openai_file_id")
        .eq("chatbot_id", chatbot.id)
        .in("id", ids)
      if (focusError) throw focusError
      const found = (rows ?? []) as Array<{
        id: string
        file_name: string
        openai_file_id: string | null
      }>
      if (found.length !== ids.length) {
        throw new HttpError(404, "Document not found in this assistant")
      }
      if (found.some((row) => !row.openai_file_id)) {
        throw new HttpError(409, "The document is not indexed yet")
      }
      focusDocs = ids.map((id) => {
        const row = found.find((r) => r.id === id)!
        return { id, title: row.file_name }
      })
      focusAction = body.focus.action
    }

    const options = chatbot.audience_options ?? []
    const prefs =
      options.length > 0
        ? await getPrefs(supabase, user.id, chatbot.id, options).catch(
            (error) => {
              console.error("getPrefs", error)
              return EMPTY_PREFS
            }
          )
        : EMPTY_PREFS
    const entity = prefs.entity_type

    let filter: ReturnType<typeof audienceFilter> | null = null
    if (
      !focusAction &&
      entity &&
      chatbot.audience_filter &&
      body.useEntityFilter !== false
    ) {
      const visible = visibleDocumentCount(
        documents as Array<{ audience: string[] | null }>,
        options,
        entity
      )
      if (visible >= MIN_VISIBLE_DOCUMENTS && visible < documents.length) {
        filter = audienceFilter(entity)
      }
    }
    const entityFilter =
      !focusAction && entity && chatbot.audience_filter
        ? { applied: Boolean(filter), entity }
        : null

    const lastAssistant = [...history]
      .reverse()
      .find((m) => m.role === "assistant")
    const allowClarify = !focusAction && !lastAssistant?.meta?.clarify
    const clarifyContext = { entityOptions: options, entityKnown: Boolean(entity) }

    if (body.research) {
      if (!body.stream) throw new HttpError(400, "Research mode needs stream: true")
      if (focusAction) throw new HttpError(400, "Research mode cannot be combined with a document action")
      if (!chatbot.research_enabled) {
        throw new HttpError(403, "Research mode is turned off for this assistant")
      }
      const used = await researchRunsToday(supabase, user.id, chatbot.id)
      if (used >= RESEARCH_DAILY_LIMIT) {
        throw new HttpError(
          429,
          `Alcanzaste el límite de ${RESEARCH_DAILY_LIMIT} investigaciones a fondo por día. Puedes seguir preguntando normalmente.`
        )
      }
      return researchResponse({
        supabase,
        chatbot,
        vectorStoreId: chatbot.vector_store_id,
        userId: user.id,
        sessionId: body.sessionId,
        title,
        userMessage,
        history,
        entity,
        filter,
        entityFilter,
        language,
        userMessageId,
        webLookup: startWebLookup(userMessage),
        passage: body.passage ?? null,
      })
    }

    const webLookup = startWebLookup(userMessage)
    const modelInput: ModelInput = {
      chatbot,
      vectorStoreId: chatbot.vector_store_id,
      userId: user.id,
      sessionId: body.sessionId,
      userMessage,
      history,
      entity,
      filter: focusAction ? focusFilter(focusDocs.map((d) => d.id)) : filter,
      clarify: allowClarify ? clarifyContext : null,
      focus: focusAction ? { action: focusAction, docs: focusDocs } : null,
      language,
      passage: body.passage ?? null,
    }
    const finish = (response: OpenAIResponse) =>
      finishAnswer({
        supabase,
        chatbot,
        userId: user.id,
        sessionId: body.sessionId,
        title,
        response,
        allowClarify,
        clarifyContext,
        entityFilter,
        webLookup,
      })

    if (body.stream) {
      const events = await askModelStream(modelInput)
      const followUps = async (answer: FinishedAnswer) => {
        const questions = await generateFollowUps({
          assistantName: chatbot.name,
          question: userMessage,
          answer: answer.output_text,
          language,
        })
        if (questions.length > 0) {
          await updateMessageMeta(getAdminClient(), {
            id: answer.id,
            userId: user.id,
            patch: { follow_ups: questions },
          })
        }
        return questions
      }
      return streamAnswer(
        async () => events,
        finish,
        followUps,
        allowClarify,
        userMessageId
      )
    }

    const finished = await finish(await askModel(modelInput))
    return NextResponse.json({ ...finished, user_message_id: userMessageId })
  } catch (error) {
    return errorResponse(error, "POST /api/chat")
  }
}

/**
 * The answer text of a response. Non-streaming responses carry it as
 * `output_text`; the final object of a stream does not, so it is rebuilt from
 * the message items.
 */
function answerText(response: OpenAIResponse): string {
  if (response.output_text) return response.output_text
  return response.output
    .flatMap((item) => (item.type === "message" ? item.content : []))
    .flatMap((part) => (part.type === "output_text" ? [part.text] : []))
    .join("")
}

/** Citations, formatting and persistence shared by both response modes. */
async function finishAnswer(input: {
  supabase: AnySupabase
  chatbot: ChatbotRow
  userId: string
  sessionId: string
  title: string
  response: OpenAIResponse
  allowClarify: boolean
  clarifyContext: { entityOptions: string[]; entityKnown: boolean }
  entityFilter: { applied: boolean; entity: string } | null
  /** Research mode: citations come from the evidence, and the steps are kept with the message. */
  research?: { citations: ChatCitation[]; steps: ResearchStepSummary[] }
  webLookup?: Promise<WebLookup | null>
}) {
  const { supabase, chatbot, userId, sessionId, title, response, entityFilter } =
    input
  const parsed = parseClarify(answerText(response), input.clarifyContext)
  const clarify: Clarify | null = input.allowClarify ? parsed.clarify : null
  const isQuestion = clarify !== null || parsed.text !== answerText(response)

  const web = input.webLookup ? await input.webLookup : null
  const citations = input.research
    ? input.research.citations
    : isQuestion
      ? []
      : await buildCitations(supabase, chatbot.id, response)
  const outputText = isQuestion ? parsed.text : formatReferences(parsed.text)

  await storeMessage(supabase, {
    id: response.id,
    message: outputText,
    userId,
    sessionId,
    chatbotId: chatbot.id,
    role: "assistant",
    title,
    citations: citations.map((c) => ({
      number: c.number,
      title: c.title,
      url: c.file_url,
      outdated: c.outdated,
      text: c.text,
      location: c.location,
    })),
    meta: {
      ...(clarify ? { clarify } : {}),
      ...(entityFilter ? { entity_filter: entityFilter } : {}),
      ...(input.research ? { research: { steps: input.research.steps } } : {}),
      ...(web && !isQuestion ? { web_sources: web } : {}),
    },
  })

  return {
    id: response.id,
    output_text: outputText,
    citations,
    clarify,
    entity_filter: entityFilter,
    research: input.research ? { steps: input.research.steps } : null,
    web_sources: web && !isQuestion ? web : null,
  }
}

/** Separate web call. A normal legal question does not start it. */
function startWebLookup(question: string): Promise<WebLookup | null> {
  if (!asksForNewerOfficialSource(question)) return Promise.resolve(null)
  return searchNewerOfficialSource({ question }).catch((error) => {
    console.error("web search", error)
    return null
  })
}

interface ResearchStepSummary {
  label: string
  sources: number
}

/** Research answers the user already got in the last 24 hours. */
async function researchRunsToday(
  supabase: AnySupabase,
  userId: string,
  chatbotId: string
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
  const { count, error } = await supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("chatbot_id", chatbotId)
    .eq("role", "assistant")
    .not("meta->research", "is", null)
    .gte("created_at", since)
  if (error) throw error
  return count ?? 0
}

/**
 * "Investigar a fondo": plan several searches, run them in parallel while
 * reporting each step, then write one answer from the combined evidence.
 */
function researchResponse(input: {
  supabase: AnySupabase
  chatbot: ChatbotRow
  vectorStoreId: string
  userId: string
  sessionId: string
  title: string
  userMessage: string
  history: StoredMessage[]
  entity: string | null
  filter: ReturnType<typeof audienceFilter> | null
  entityFilter: { applied: boolean; entity: string } | null
  language: "en" | "es"
  userMessageId: string
  webLookup: Promise<WebLookup | null>
  passage: PassageContext | null
}): Response {
  const { supabase, chatbot, userId, userMessage } = input
  let evidence: EvidenceDocument[] = []
  let summaries: ResearchStepSummary[] = []

  const start = async (send: SendEvent) => {
    const previousQuestion = [...input.history]
      .reverse()
      .find((m) => m.role === "user")?.message
    send({ type: "status", status: "planning" })
    const steps: SubQuestion[] = await planResearch({
      assistantName: chatbot.name,
      question: userMessage,
      previousQuestion,
    })
    send({
      type: "plan",
      steps: steps.map((s) => ({ id: s.id, label: s.label })),
    })

    const hitsByStep: SearchHit[][] = await Promise.all(
      steps.map(async (step) => {
        send({ type: "step", id: step.id, status: "searching" })
        const hits = await runSearch({
          vectorStoreId: input.vectorStoreId,
          query: step.query,
          filter: input.filter,
        }).catch((error) => {
          console.error("research search", step.query, error)
          return [] as SearchHit[]
        })
        send({
          type: "step",
          id: step.id,
          status: "done",
          sources: countDocuments(hits),
        })
        return hits
      })
    )
    summaries = steps.map((step, index) => ({
      label: step.label,
      sources: countDocuments(hitsByStep[index]),
    }))
    evidence = buildEvidence(hitsByStep)
    send({ type: "status", status: "writing" })

    return askModelStream({
      chatbot,
      vectorStoreId: input.vectorStoreId,
      userId,
      sessionId: input.sessionId,
      userMessage,
      history: input.history,
      entity: input.entity,
      filter: null,
      focus: null,
      clarify: null,
      research: {
        input: evidenceInput(
          input.passage ? questionWithPassage(userMessage, input.passage) : userMessage,
          steps,
          evidence
        ),
      },
      language: input.language,
    })
  }

  const finish = async (response: OpenAIResponse) =>
    finishAnswer({
      supabase,
      chatbot,
      userId,
      sessionId: input.sessionId,
      title: input.title,
      response,
      allowClarify: false,
      clarifyContext: { entityOptions: [], entityKnown: true },
      entityFilter: input.entityFilter,
      research: {
        citations: await evidenceCitations(supabase, chatbot.id, evidence),
        steps: summaries,
      },
      webLookup: input.webLookup,
    })

  const followUps = async (answer: FinishedAnswer) => {
    const questions = await generateFollowUps({
      assistantName: chatbot.name,
      question: userMessage,
      answer: answer.output_text,
      language: input.language,
    })
    if (questions.length > 0) {
      await updateMessageMeta(getAdminClient(), {
        id: answer.id,
        userId,
        patch: { follow_ups: questions },
      })
    }
    return questions
  }

  return streamAnswer(start, finish, followUps, false, input.userMessageId)
}

type FinishedAnswer = Awaited<ReturnType<typeof finishAnswer>>

type SendEvent = (event: Record<string, unknown>) => void

/**
 * Streams the answer as newline-delimited JSON:
 *   {"type":"status","status":"searching"}
 *   {"type":"delta","text":"..."}            (many)
 *   {"type":"done","id","output_text","citations","clarify","entity_filter"}
 *                                            final, formatted text; "clarify" is a
 *                                            question with option buttons (or null)
 *   {"type":"followups","questions":[...]}   optional, after done
 * Research mode adds, before the first delta:
 *   {"type":"plan","steps":[{"id","label"}]}
 *   {"type":"step","id","status":"searching"|"done","sources":N}
 *   {"type":"error","message":"..."}         instead of "done" on failure
 * The answer is stored once the model has finished, even if the browser
 * disconnected in the meantime.
 */
function streamAnswer(
  start: (send: SendEvent) => Promise<AsyncIterable<ResponseStreamEvent>>,
  finish: (response: OpenAIResponse) => Promise<FinishedAnswer>,
  followUps: (answer: FinishedAnswer) => Promise<string[]>,
  allowClarify: boolean,
  userMessageId: string
): Response {
  const encoder = new TextEncoder()
  const gate = allowClarify ? new ClarifyGate() : null

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true
      const send = (event: Record<string, unknown>) => {
        if (!open) return
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`))
        } catch {
          open = false // the browser went away; keep going so the answer is saved
        }
      }

      try {
        let final: OpenAIResponse | null = null
        const events = await start(send)
        for await (const event of events) {
          if (event.type === "response.file_search_call.searching") {
            send({ type: "status", status: "searching" })
          } else if (event.type === "response.output_text.delta") {
            const text = gate ? gate.push(event.delta) : event.delta
            if (text) send({ type: "delta", text })
          } else if (
            event.type === "response.completed" ||
            event.type === "response.incomplete"
          ) {
            final = event.response
          } else if (event.type === "response.failed") {
            throw new Error(event.response.error?.message ?? "The model failed")
          } else if (event.type === "error") {
            throw new Error(event.message)
          }
        }
        if (!final) throw new Error("The model stream ended without a response")
        const held = gate?.flush()
        if (held) send({ type: "delta", text: held })
        const answer = await finish(final)
        send({ type: "done", ...answer, user_message_id: userMessageId })
        if (answer.clarify) return
        // The answer is already on screen; suggestions follow when ready.
        const questions = await followUps(answer).catch((error) => {
          console.error("follow-ups", error)
          return [] as string[]
        })
        if (questions.length > 0) send({ type: "followups", questions })
      } catch (error) {
        console.error("POST /api/chat (stream)", error)
        send({
          type: "error",
          message: "No se pudo completar la respuesta. Inténtalo de nuevo.",
        })
      } finally {
        if (open) controller.close()
      }
    },
  })

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  })
}

async function respondLocally(
  supabase: AnySupabase,
  chatbot: ChatbotRow,
  userId: string,
  sessionId: string,
  title: string,
  userMessageId: string
) {
  // Not an OpenAI id (no "resp_" prefix) so it is never used as previous_response_id.
  const id = `local_${uuidv4()}`
  await storeMessage(supabase, {
    id,
    message: NO_DOCUMENTS_MESSAGE,
    userId,
    sessionId,
    chatbotId: chatbot.id,
    role: "assistant",
    title,
  })
  return NextResponse.json({
    id,
    output_text: NO_DOCUMENTS_MESSAGE,
    citations: [] satisfies ChatCitation[],
    user_message_id: userMessageId,
  })
}

/** Keeps profiles.total_messages roughly in sync. */
async function incrementMessageCount(supabase: AnySupabase, userId: string) {
  try {
    const { data } = await supabase
      .from("profiles")
      .select("total_messages")
      .eq("id", userId)
      .maybeSingle()
    await supabase
      .from("profiles")
      .update({ total_messages: (data?.total_messages ?? 0) + 1 })
      .eq("id", userId)
  } catch (error) {
    console.error("incrementMessageCount", error)
  }
}

function isStalePreviousResponse(error: unknown): boolean {
  const e = error as { status?: number; message?: string } | null
  return (
    e?.status === 404 ||
    (e?.status === 400 && /previous[_ ]response/i.test(e.message ?? ""))
  )
}

type FileSearchFilter = NonNullable<FileSearchTool["filters"]>

interface ModelInput {
  chatbot: ChatbotRow
  vectorStoreId: string
  userId: string
  sessionId: string
  userMessage: string
  history: StoredMessage[]
  /** Entity type of the user, if known. */
  entity: string | null
  /** file_search filter: the entity type, or the documents of a document action. */
  filter: FileSearchFilter | null
  /** Document action in progress, if any. */
  focus: { action: "summarize" | "compare" | "changes"; docs: FocusDocument[] } | null
  /** Research writing step: the evidence is in the input and no search tool is offered. */
  research?: { input: string } | null
  /** Set when the model may ask a clarifying question this turn. */
  clarify: { entityOptions: string[]; entityKnown: boolean } | null
  /** Language of this question. Spanish stays the default. */
  language: "en" | "es"
  /** Passage chosen in Fuentes, sent only to the model for this turn. */
  passage?: PassageContext | null
}

/**
 * Builds the Responses API request and runs it with `run`, which decides
 * whether it is streamed. If the chained previous response has expired the
 * request is retried once with the recent history replayed instead.
 */
async function callModel<T>(
  input: ModelInput,
  run: (params: ResponseCreateParamsBase) => Promise<T>
): Promise<T> {
  const instructions =
    (input.chatbot.system_prompt?.trim() ||
      buildDefaultSystemPrompt(input.chatbot)) +
    promptNotesBlock(input.chatbot.prompt_notes) +
    (input.focus ? focusInstructions(input.focus.action, input.focus.docs) : "") +
    (input.research ? RESEARCH_INSTRUCTIONS : "") +
    userContextLine(input.entity) +
    (input.clarify ? clarifyInstructions(input.clarify) : "") +
    languageInstruction(input.language) +
    LIBRARY_GROUNDING

  // `instructions` are not carried over by previous_response_id, so they are
  // sent on every request. Prior turns are: either chained through the last
  // stored response or, if that response expired, replayed from our history.
  const previousResponseId = lastResponseId(input.history)

  const base: Omit<ResponseCreateParamsBase, "input"> = {
    model: aiConfig.answerModel,
    instructions,
    ...(input.research
      ? {}
      : {
          tools: [
            fileSearchTool({
              vectorStoreId: input.vectorStoreId,
              maxNumResults: input.focus
                ? Math.max(aiConfig.fileSearchMaxResults, FOCUS_MAX_RESULTS)
                : aiConfig.fileSearchMaxResults,
              filters: input.filter,
            }),
          ],
          tool_choice: { type: "file_search" as const },
          include: ["file_search_call.results" as const],
        }),
    reasoning: { effort: aiConfig.answerEffort },
    text: { verbosity: aiConfig.answerVerbosity },
    max_output_tokens: aiConfig.maxOutputTokens,
    store: true,
    metadata: {
      chatbot_id: input.chatbot.id,
      session_id: input.sessionId,
      user_id: input.userId,
    },
  }

  const asked = input.passage
    ? questionWithPassage(input.userMessage, input.passage)
    : input.userMessage
  const currentTurn: ResponseInput = [
    { role: "user", content: input.research?.input ?? asked },
  ]

  if (previousResponseId) {
    try {
      return await run({
        ...base,
        input: currentTurn,
        previous_response_id: previousResponseId,
      })
    } catch (error) {
      if (!isStalePreviousResponse(error)) throw error
      console.warn("previous response unavailable, replaying history")
    }
  }

  const replay: ResponseInput = input.history.slice(-10).map((m) => {
    const passage = m.role === "user" ? readPassage(m.meta.passage) : null
    return {
      role: m.role,
      content: passage ? questionWithPassage(m.message, passage) : m.message,
    }
  })
  return run({ ...base, input: [...replay, ...currentTurn] })
}

function askModel(input: ModelInput): Promise<OpenAIResponse> {
  const openai = getOpenAI()
  return callModel(input, (params) =>
    openai.responses.create({ ...params, stream: false })
  )
}

function askModelStream(
  input: ModelInput
): Promise<AsyncIterable<ResponseStreamEvent>> {
  const openai = getOpenAI()
  return callModel(input, (params) =>
    openai.responses.create({ ...params, stream: true })
  )
}

interface DocRow {
  id: string
  file_name: string
  outdated: boolean | null
}

/**
 * Builds the citation list from what file_search retrieved, restricted to the
 * documents of this chatbot. Documents cited by the model come first, in the
 * order they appear in the answer.
 */
async function buildCitations(
  supabase: AnySupabase,
  chatbotId: string,
  response: OpenAIResponse
): Promise<ChatCitation[]> {
  const retrieved = response.output
    .filter(
      (item): item is ResponseFileSearchToolCall =>
        item.type === "file_search_call"
    )
    .flatMap((item) => item.results ?? [])

  const citedOrder: string[] = []
  for (const item of response.output) {
    if (item.type !== "message") continue
    for (const part of item.content) {
      if (part.type !== "output_text") continue
      for (const annotation of part.annotations) {
        if (
          annotation.type === "file_citation" &&
          !citedOrder.includes(annotation.file_id)
        ) {
          citedOrder.push(annotation.file_id)
        }
      }
    }
  }

  // One entry per document, with every retrieved chunk so the stored
  // passage still contains a fact that was not the single top score.
  const best = new Map<string, RetrievedDocument>()
  for (const result of retrieved) absorbResult(best, result)

  const ordered = [
    ...citedOrder.filter((id) => best.has(id)),
    ...Array.from(best.keys()).filter((id) => !citedOrder.includes(id)),
  ]
  return citationsFor(supabase, chatbotId, ordered, best)
}

interface RetrievedPassage {
  file_id?: string | null
  filename?: string | null
  text?: string | null
  score?: number | null
  attributes?: Record<string, string | number | boolean> | null
}

interface RetrievedDocument {
  file_id?: string | null
  filename?: string | null
  score: number
  attributes: Record<string, string | number | boolean>
  passages: ScoredPassage[]
}

const LOCATION_FIELDS = [
  "page",
  "page_number",
  "start_page",
  "end_page",
  "article",
  "articulo",
  "file_location",
  "location",
  "section",
] as const

/** Attributes plus a location field if the search result carries one beside them. */
function metadataOf(
  result: RetrievedPassage
): Record<string, string | number | boolean> {
  const raw = result as unknown as Record<string, unknown>
  const extra: Record<string, string | number | boolean> = {}
  for (const key of LOCATION_FIELDS) {
    const value = raw[key]
    if (typeof value === "string" || typeof value === "number") extra[key] = value
  }
  return { ...extra, ...(result.attributes ?? {}) }
}

function absorbResult(best: Map<string, RetrievedDocument>, result: RetrievedPassage) {
  const key = result.file_id ?? result.filename
  if (!key) return
  const text = (result.text ?? "").trim()
  const attributes = metadataOf(result)
  let doc = best.get(key)
  if (!doc) {
    doc = {
      file_id: result.file_id,
      filename: result.filename,
      score: result.score ?? 0,
      attributes,
      passages: [],
    }
    best.set(key, doc)
  } else {
    doc.attributes = { ...attributes, ...doc.attributes }
  }
  doc.score = Math.max(doc.score, result.score ?? 0)
  if (text && !doc.passages.some((passage) => passage.text === text)) {
    doc.passages.push({ text, score: result.score ?? 0 })
  }
}

/** Citations for documents in the given order (number = position), resolved against the Library. */
async function citationsFor(
  supabase: AnySupabase,
  chatbotId: string,
  ordered: string[],
  best: Map<string, RetrievedDocument>
): Promise<ChatCitation[]> {
  if (ordered.length === 0) return []

  const fileIds = ordered.filter((id) => id.startsWith("file-"))
  const filenames = Array.from(
    new Set(
      ordered
        .map((id) => best.get(id)?.filename)
        .filter((n): n is string => Boolean(n))
    )
  )

  const [byId, byName] = await Promise.all([
    fileIds.length
      ? supabase
          .from("files")
          .select("id, file_name, openai_file_id, outdated")
          .eq("chatbot_id", chatbotId)
          .in("openai_file_id", fileIds)
      : Promise.resolve({ data: [] as any[] }),
    filenames.length
      ? supabase
          .from("files")
          .select("id, file_name, openai_file_id, outdated")
          .eq("chatbot_id", chatbotId)
          .in("file_name", filenames)
      : Promise.resolve({ data: [] as any[] }),
  ])

  const rowByOpenAiId = new Map<string, DocRow>()
  for (const row of byId.data ?? []) rowByOpenAiId.set(row.openai_file_id, row)
  const rowByName = new Map<string, DocRow>()
  for (const row of byName.data ?? []) rowByName.set(row.file_name, row)

  return ordered.map((key, index) => {
    const result = best.get(key)!
    const row =
      (result.file_id && rowByOpenAiId.get(result.file_id)) ||
      (result.filename && rowByName.get(result.filename)) ||
      null
    return {
      number: index + 1,
      file_id: result.file_id ?? "",
      filename: result.filename ?? "",
      title: row?.file_name ?? result.filename ?? "Documento",
      text: joinPassages(result.passages),
      score: result.score,
      attributes: result.attributes ?? {},
      file_url: row ? `/api/files/${row.id}/download` : null,
      outdated: row?.outdated ? true : undefined,
      location: locationFromMetadata(result.attributes, {
        title: row?.file_name,
        filename: result.filename,
      }),
    }
  })
}

/** Evidence documents as citations, numbered as the model saw them. */
async function evidenceCitations(
  supabase: AnySupabase,
  chatbotId: string,
  evidence: EvidenceDocument[]
): Promise<ChatCitation[]> {
  const best = new Map<string, RetrievedDocument>()
  const ordered: string[] = []
  for (const doc of evidence) {
    const key = doc.fileId || doc.filename
    ordered.push(key)
    best.set(key, {
      file_id: doc.fileId,
      filename: doc.filename,
      score: doc.score,
      attributes: doc.attributes,
      passages: doc.passages,
    })
  }
  return citationsFor(supabase, chatbotId, ordered, best)
}

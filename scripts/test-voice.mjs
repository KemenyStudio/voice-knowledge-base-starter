// Unit checks for the Spanish voice call.   node scripts/test-voice.mjs
import assert from "node:assert/strict"
import { register } from "node:module"

register(new URL("./resolve-alias.mjs", import.meta.url).href)

const { matchVoiceCommand } = await import("../lib/voice/commands.ts")
const { classifyVoiceEvent, consultaFromToolArgs, toolStringArg } = await import("../lib/voice/events.ts")
const { voiceEntityFilter } = await import("../lib/voice/filter.ts")
const { HANGUP_PHRASES_DISPLAY, isHangupUtterance } = await import("../lib/voice/hangup.ts")
const {
  parseVoiceCallSettings,
  voiceSearchGeneration,
} = await import("../lib/voice/call-settings.ts")
const {
  APP_TOOL_NAME,
  HANGUP_TOOL_NAME,
  LIBRARY_SUMMARY_TOOL_NAME,
  LIBRARY_TOOL_NAME,
  LIST_TOOL_NAME,
  NAVIGATE_TOOL_NAME,
  OPEN_TOOL_NAME,
  REMEMBER_TOOL_NAME,
  VOICE_TOOL_NAMES,
  buildRealtimeSession,
  buildSearchInstructions,
  buildVoiceInstructions,
  isAsyncVoiceTool,
  spokenCapabilities,
  toolsForNavigation,
} = await import("../lib/voice/instructions.ts")
const { citedLibrarySpeech } = await import("../lib/voice/cited.ts")
const { matchLibraryFile } = await import("../lib/voice/library-match.ts")
const {
  parseLibraryHealthSummary,
  speakLibraryHealthSummary,
} = await import("../lib/voice/library-summary.ts")
const {
  gateAsyncFinished,
  gateAsyncStarted,
  gateRequestResponse,
  gateResponseBusy,
  gateResponseFinished,
  gateToolFinished,
  gateToolStarted,
  idleResponseGate,
} = await import("../lib/voice/response-gate.ts")
const { realtimeSecretHeaders } = await import("../lib/voice/secret.ts")
const { speakFeedback, speakLibraryCounts, speakMemberCount } = await import("../lib/voice/app-speech.ts")
const { EMPTY_TRANSCRIPT, reduceTranscript } = await import("../lib/voice/transcript.ts")

const chatbot = {
  name: "Library",
  description: "Private documents",
  system_prompt: "You search the private library and cite passages.",
  prompt_notes: ["Cite the passage when it applies."],
}

const voice = buildVoiceInstructions(chatbot, "Banks")
assert.match(voice, /private library/)
assert.match(voice, /Cite the passage/)
assert.match(voice, /perfil "Banks"/)
assert.match(voice, /únicamente en español/)
assert.match(voice, /español de México/)
assert.match(voice, new RegExp(LIBRARY_TOOL_NAME))
assert.match(voice, /No digas que la búsqueda sigue en proceso/)
assert.match(voice, new RegExp(HANGUP_TOOL_NAME))

const search = buildSearchInstructions(chatbot, null)
assert.match(search, /private library/)
assert.equal(search.includes("entidad de tipo"), false)
assert.match(search, /Referencias/)
assert.match(search, /ocho oraciones/)

const breve = buildSearchInstructions(chatbot, null, "breve")
assert.match(breve, /tres oraciones/)
const detallada = buildSearchInstructions(chatbot, null, "detallada")
assert.match(detallada, /dieciséis oraciones/)
assert.deepEqual(voiceSearchGeneration("normal", 8000), {
  verbosity: "low",
  max_output_tokens: 2000,
})
assert.deepEqual(voiceSearchGeneration("breve", 8000).verbosity, "low")
assert.equal(voiceSearchGeneration("breve", 8000).max_output_tokens < 2000, true)
assert.deepEqual(voiceSearchGeneration("detallada", 8000), {
  verbosity: "high",
  max_output_tokens: 8000,
})
assert.equal(voiceSearchGeneration("detallada", 1500).max_output_tokens, 1500)
assert.deepEqual(parseVoiceCallSettings(null), { length: "normal", navigation: "app" })
assert.deepEqual(parseVoiceCallSettings({ voice_length: "nope", voice_navigation: "library" }), {
  length: "normal",
  navigation: "library",
})

const libraryVoice = buildVoiceInstructions(chatbot, "Banks", {
  length: "normal",
  navigation: "library",
})
assert.match(libraryVoice, /No abras otras pantallas/)
assert.equal(libraryVoice.includes("Habla en frases cortas"), true)
assert.equal(libraryVoice.includes(NAVIGATE_TOOL_NAME), false)
assert.match(libraryVoice, /end the call/)
const shortVoice = buildVoiceInstructions(chatbot, null, {
  length: "breve",
  navigation: "app",
})
assert.match(shortVoice, /una o dos frases/)
assert.equal(shortVoice.includes("No abras otras pantallas"), false)
assert.match(shortVoice, new RegExp(NAVIGATE_TOOL_NAME))
assert.match(shortVoice, /what can you do/)

const session = buildRealtimeSession({
  instructions: voice,
  voice: "marin",
  model: "gpt-realtime-2.1",
  entityOptions: ["Banks", "Brokers"],
})
assert.equal(session.type, "realtime")
assert.equal(session.audio.output.voice, "marin")
assert.equal(session.audio.input.transcription.language, "es")
assert.equal(session.audio.input.transcription.model, "gpt-4o-transcribe")
assert.deepEqual(
  session.tools.map((tool) => tool.name),
  [...VOICE_TOOL_NAMES]
)
assert.equal(session.tools[0].parameters.required.includes("consulta"), true)
assert.match(session.tools.find((tool) => tool.name === REMEMBER_TOOL_NAME).description, /Banks/)
assert.equal(JSON.stringify(session).includes(["sk", ""].join("-")), false)
assert.equal(JSON.stringify(session).includes('"async"'), false)
assert.equal(session.audio.input.turn_detection.type, "semantic_vad")
assert.equal(session.audio.input.turn_detection.interrupt_response, true)
for (const name of [LIBRARY_TOOL_NAME, LIST_TOOL_NAME, APP_TOOL_NAME, LIBRARY_SUMMARY_TOOL_NAME]) {
  assert.equal(isAsyncVoiceTool(name), true)
}
for (const name of [HANGUP_TOOL_NAME, NAVIGATE_TOOL_NAME, OPEN_TOOL_NAME, REMEMBER_TOOL_NAME]) {
  assert.equal(isAsyncVoiceTool(name), false)
}
assert.match(spokenCapabilities(), /buscar en la biblioteca/)
assert.match(spokenCapabilities(), /colgar/)
assert.equal(spokenCapabilities().includes("contraseña"), false)
assert.equal(spokenCapabilities().includes("borrar"), false)

const sampleKey = ["sk", "test"].join("-")
const secretHeaders = realtimeSecretHeaders(sampleKey, "user-1")
assert.equal("OpenAI-Beta" in secretHeaders, false)
assert.equal(secretHeaders["OpenAI-Safety-Identifier"], realtimeSecretHeaders(sampleKey, "user-1")["OpenAI-Safety-Identifier"])
assert.notEqual(secretHeaders["OpenAI-Safety-Identifier"], realtimeSecretHeaders(sampleKey, "user-2")["OpenAI-Safety-Identifier"])

const withScreen = toolsForNavigation(session.tools, "library")
assert.equal(withScreen.some((tool) => tool.name === NAVIGATE_TOOL_NAME), false)
assert.equal(withScreen.some((tool) => tool.name === APP_TOOL_NAME), false)
assert.equal(withScreen.some((tool) => tool.name === LIBRARY_TOOL_NAME), true)
assert.equal(withScreen.some((tool) => tool.name === HANGUP_TOOL_NAME), true)
const screensOn = toolsForNavigation(session.tools, "app")
assert.equal(screensOn.some((tool) => tool.name === NAVIGATE_TOOL_NAME), true)

for (const phrase of HANGUP_PHRASES_DISPLAY) {
  assert.equal(isHangupUtterance(phrase), true, phrase)
}

const docs = [
  { audience: ["Bancos"] },
  { audience: ["Bancos"] },
  { audience: ["Bancos"] },
  { audience: ["Sofipos"] },
]
const narrowed = voiceEntityFilter({
  entity: "Bancos",
  audienceFilterEnabled: true,
  documents: docs,
  options: ["Bancos", "Sofipos"],
  searchAll: false,
})
assert.equal(narrowed.entityFilter.applied, true)
assert.equal(narrowed.filter.key, "excl_bancos")

const all = voiceEntityFilter({ ...narrowed, entity: "Bancos", audienceFilterEnabled: true, documents: docs, options: ["Bancos", "Sofipos"], searchAll: true })
assert.equal(all.filter, null)
assert.equal(all.entityFilter.applied, false)

const off = voiceEntityFilter({
  entity: "Bancos",
  audienceFilterEnabled: false,
  documents: docs,
  options: ["Bancos", "Sofipos"],
  searchAll: false,
})
assert.equal(off.entityFilter, null)

const thin = voiceEntityFilter({
  entity: "Sofipos",
  audienceFilterEnabled: true,
  documents: docs,
  options: ["Bancos", "Sofipos"],
  searchAll: false,
})
assert.equal(thin.filter, null)
assert.equal(thin.entityFilter.applied, false)

assert.deepEqual(consultaFromToolArgs('{"consulta":"¿Sofipos?","todos_los_documentos":true}'), {
  consulta: "¿Sofipos?",
  searchAll: true,
})
assert.equal(consultaFromToolArgs("no es json").consulta, "no es json")
assert.equal(consultaFromToolArgs("no es json").searchAll, false)

assert.equal(classifyVoiceEvent({ type: "response.output_audio_transcript.delta", item_id: "a", delta: "Hola" }).kind, "assistant-delta")
assert.equal(classifyVoiceEvent({ type: "conversation.item.input_audio_transcription.completed", item_id: "u", transcript: "Buenos días" }).kind, "user-done")
const tool = classifyVoiceEvent({
  type: "response.function_call_arguments.done",
  call_id: "c1",
  name: LIBRARY_TOOL_NAME,
  arguments: "{}",
})
assert.equal(tool.kind, "tool")
assert.equal(classifyVoiceEvent({ type: "response.created", response: { id: "resp_1" } }).kind, "response-started")
assert.equal(classifyVoiceEvent({ type: "response.done", response: { id: "resp_1" } }).kind, "response-finished")
assert.equal(classifyVoiceEvent({ type: "response.cancelled", response: { id: "resp_1" } }).kind, "response-finished")
assert.equal(
  classifyVoiceEvent({
    type: "error",
    error: { message: "Conversation already has an active response in progress: resp_1. Wait until the response is finished before creating a new one." },
  }).kind,
  "response-busy"
)
assert.equal(classifyVoiceEvent({ type: "error", error: { message: "otra cosa" } }).kind, "error")
assert.equal(toolStringArg('{"titulo":"Ley"}', "titulo"), "Ley")

let gate = idleResponseGate()
let step = gateRequestResponse(gate)
assert.equal(step.create, true)
assert.equal(step.gate.active, true)
step = gateRequestResponse(step.gate)
assert.equal(step.create, false)
assert.equal(step.gate.followUp, true)
step = gateResponseFinished(step.gate)
assert.equal(step.create, true)
assert.equal(step.gate.followUp, false)
gate = gateToolStarted(step.gate)
gate = gateToolStarted(gate)
step = gateResponseFinished(gate)
assert.equal(step.create, false)
step = gateToolFinished(step.gate, true)
assert.equal(step.create, false)
assert.equal(step.gate.tools, 1)
step = gateToolFinished(step.gate, true)
assert.equal(step.create, true)
gate = gateResponseBusy(idleResponseGate())
assert.equal(gate.active, true)
assert.equal(gate.followUp, true)
step = gateToolFinished(gateToolStarted(idleResponseGate()), false)
assert.equal(step.create, false)
assert.equal(step.gate.followUp, false)

assert.equal(isHangupUtterance("cuelga"), true)
assert.equal(isHangupUtterance("Termina la llamada"), true)
assert.equal(isHangupUtterance("¡Adiós!"), true)
assert.equal(isHangupUtterance("adiós, gracias"), true)
assert.equal(isHangupUtterance("adiós, ¿qué dice la ley?"), false)
assert.equal(isHangupUtterance("qué dice la circular"), false)
assert.equal(isHangupUtterance("end the call"), true)
assert.equal(isHangupUtterance("please hang up"), true)
assert.equal(isHangupUtterance("terminar la llamada"), true)
assert.equal(isHangupUtterance("chao"), true)
assert.equal(isHangupUtterance("hasta luego"), true)
assert.equal(isHangupUtterance("end the call, what does the law say?"), false)

assert.equal(matchVoiceCommand("abre la biblioteca").type, "navigate")
assert.equal(matchVoiceCommand("abre la biblioteca").screen, "biblioteca")
assert.equal(matchVoiceCommand("open members").screen, "miembros")
assert.equal(matchVoiceCommand("cuántos usuarios hay").dato, "miembros")
assert.equal(matchVoiceCommand("what can you do").type, "capabilities")
assert.equal(matchVoiceCommand("qué herramientas tienes").type, "capabilities")
assert.equal(matchVoiceCommand("adiós, ¿qué dice la ley?"), null)

const cited = citedLibrarySpeech([
  { numero: 1, titulo: "Ley", extracto: "El artículo 5 fija el plazo.", desactualizado: false },
])
assert.equal(cited.cited, true)
assert.match(cited.respuesta, /artículo 5/)
const empty = citedLibrarySpeech([
  { numero: 1, titulo: "Ley", extracto: "  ", desactualizado: false },
])
assert.equal(empty.cited, false)
assert.equal(empty.documentos.length, 0)

const summary = parseLibraryHealthSummary({
  counts: {
    documents: 10,
    indexFiles: 9,
    chunks: null,
    ready: 8,
    needsAttention: 2,
    missingAudience: 1,
    weakIndex: 3,
  },
  worst: [
    { name: "Circular única" },
    { name: "Ley de Instituciones de Crédito" },
    { name: "Tercero" },
    { name: "Cuarto" },
    { name: "Quinto" },
    { name: "Sexto, no se dice" },
  ],
})
assert.equal(summary.chunks, null)
assert.equal(summary.worst.length, 5)
assert.match(speakLibraryHealthSummary(summary), /10 documentos/)
assert.match(speakLibraryHealthSummary(summary), /8 listos/)
assert.match(speakLibraryHealthSummary(summary), /2 que necesitan atención/)
assert.match(speakLibraryHealthSummary(summary), /1 sin audiencia/)
assert.match(speakLibraryHealthSummary(summary), /3 con índice débil/)
assert.match(speakLibraryHealthSummary(summary), /9 en el índice/)
assert.match(speakLibraryHealthSummary(summary), /no publica un total de fragmentos/)
assert.match(speakLibraryHealthSummary(summary), /Circular única/)
assert.equal(speakLibraryHealthSummary(summary).includes("Sexto"), false)
assert.equal(speakLibraryHealthSummary(summary).includes("40"), false)
assert.match(speakLibraryHealthSummary(parseLibraryHealthSummary({})), /No invento/)
assert.match(speakLibraryHealthSummary(parseLibraryHealthSummary({})), /no publica un total de fragmentos/)
assert.match(speakMemberCount({ total: 3, admins: null }), /3 personas/)
assert.match(speakMemberCount({ total: 3, admins: 1 }), /administrador/)
assert.match(speakFeedback({ ratings: 2, low: 1, withoutSources: 4, scope: "own" }), /tuyas/)
assert.match(speakLibraryCounts({ documents: 5, ready: 4, attention: 1, missingLabels: 0 }), /5 documentos/)

let asyncGate = gateAsyncStarted(idleResponseGate())
let asyncStep = gateRequestResponse(asyncGate)
assert.equal(asyncStep.create, false)
asyncStep = gateAsyncFinished(asyncStep.gate, true)
assert.equal(asyncStep.create, true)
assert.equal(asyncStep.gate.asyncOpen, 0)
asyncGate = gateToolFinished(gateToolStarted(gateAsyncStarted(idleResponseGate())), true)
assert.equal(asyncGate.create, false)
assert.equal(asyncGate.gate.asyncOpen, 1)

const files = [
  { id: "1", file_name: "Ley de Instituciones de Crédito.pdf" },
  { id: "2", file_name: "Circular única de bancos.pdf" },
  { id: "3", file_name: "Circular única de sofipos.pdf" },
]
assert.equal(matchLibraryFile(files, "Ley de Instituciones de Crédito.pdf").match.id, "1")
assert.equal(matchLibraryFile(files, "ley de instituciones").match.id, "1")
assert.equal(matchLibraryFile(files, "circular única").match, null)
assert.equal(matchLibraryFile(files, "circular única").ambiguous.length, 2)

let state = reduceTranscript(EMPTY_TRANSCRIPT, { type: "delta", id: "u", role: "user", delta: "Hola" })
state = reduceTranscript(state, {
  type: "citations",
  citations: [{ number: 1, title: "Ley de Instituciones de Crédito" }],
})
state = reduceTranscript(state, { type: "delta", id: "a", role: "assistant", delta: "Según la ley" })
assert.equal(state.lines[1].citations[0].title, "Ley de Instituciones de Crédito")
assert.equal(state.pendingCitations.length, 0)
assert.equal(state.lines[0].citations, undefined)
state = reduceTranscript(state, { type: "reset" })
assert.equal(state.lines.length, 0)

console.log("voice: ok")

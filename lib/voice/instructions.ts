import { buildDefaultSystemPrompt } from "@/app/config/prompts"
import { userContextLine } from "@/lib/clarify"
import { promptNotesBlock } from "@/lib/prompt-notes"
import {
  DEFAULT_VOICE_CALL_SETTINGS,
  voiceLengthLimits,
  type VoiceCallSettings,
  type VoiceNavigation,
} from "@/lib/voice/call-settings"

/** Search tool. The server runs file_search on the assistant's vector store. */
export const LIBRARY_TOOL_NAME = "buscar_biblioteca"

/** Lists document titles already in this assistant's library. */
export const LIST_TOOL_NAME = "listar_biblioteca"

/** Opens one library document in the in-page preview. */
export const OPEN_TOOL_NAME = "abrir_documento"

/** Saves the caller's entity type on the same preference the chat uses. */
export const REMEMBER_TOOL_NAME = "recordar_perfil"

/** Ends the Realtime session the same way the Colgar button does. */
export const HANGUP_TOOL_NAME = "colgar"

/** Opens a screen in the app. The call stays up. */
export const NAVIGATE_TOOL_NAME = "abrir_pantalla"

/** Reads usage figures the signed-in caller is allowed to see. */
export const APP_TOOL_NAME = "consultar_app"

/**
 * Admin library summary from GET /api/files/summary.
 * Speaks documents, ready, attention, missing audience, weak index, files in
 * the index, and up to five worst documents. Fragment totals stay unspoken:
 * the route returns chunks as null.
 */
export const LIBRARY_SUMMARY_TOOL_NAME = "resumen_biblioteca"

export const VOICE_TOOL_NAMES = [
  LIBRARY_TOOL_NAME,
  LIST_TOOL_NAME,
  OPEN_TOOL_NAME,
  REMEMBER_TOOL_NAME,
  NAVIGATE_TOOL_NAME,
  APP_TOOL_NAME,
  LIBRARY_SUMMARY_TOOL_NAME,
  HANGUP_TOOL_NAME,
] as const

export type VoiceToolName = (typeof VOICE_TOOL_NAMES)[number]

/** Short Spanish names of the live tools. Spoken when someone asks what the call can do. */
const SPOKEN_CAPABILITIES: Record<VoiceToolName, string> = {
  [LIBRARY_TOOL_NAME]: "buscar en la biblioteca",
  [LIST_TOOL_NAME]: "listar los documentos",
  [OPEN_TOOL_NAME]: "abrir un documento",
  [REMEMBER_TOOL_NAME]: "recordar tu tipo de entidad",
  [NAVIGATE_TOOL_NAME]: "abrir pantallas de la aplicación",
  [APP_TOOL_NAME]: "leer el uso y cuántos miembros puedes ver",
  [LIBRARY_SUMMARY_TOOL_NAME]: "leer el resumen de salud de la biblioteca si administras el equipo",
  [HANGUP_TOOL_NAME]: "colgar",
}

/** One sentence that lists only the tools registered on the call. */
export function spokenCapabilities(names: readonly string[] = VOICE_TOOL_NAMES): string {
  const allowed = new Set(names)
  const listed = VOICE_TOOL_NAMES.filter((name) => allowed.has(name)).map(
    (name) => SPOKEN_CAPABILITIES[name]
  )
  return `Puedo ${listed.join(", ")}.`
}

/**
 * Slow lookups. The GA Realtime function tool (name, description, parameters, type)
 * has no `async` field — that flag belongs to the Responses API — so it is not sent
 * on the session. The call still treats these as async: it runs them in the app,
 * does not send response.create while they are open, and returns function_call_output
 * with the original call_id.
 */
export function isAsyncVoiceTool(name: string): boolean {
  return (
    name === LIBRARY_TOOL_NAME ||
    name === LIST_TOOL_NAME ||
    name === APP_TOOL_NAME ||
    name === LIBRARY_SUMMARY_TOOL_NAME
  )
}

export const REALTIME_VOICES = [
  "alloy",
  "ash",
  "ballad",
  "coral",
  "echo",
  "sage",
  "shimmer",
  "verse",
  "marin",
  "cedar",
] as const

export type RealtimeVoice = (typeof REALTIME_VOICES)[number]

/**
 * Marin is a current Realtime voice (the docs recommend marin or cedar) and
 * follows a pinned language. The session instructions lock that language to Spanish.
 */
export const DEFAULT_REALTIME_VOICE: RealtimeVoice = "marin"

/** Model id from the current Realtime WebRTC guide. */
export const DEFAULT_REALTIME_MODEL = "gpt-realtime-2.1"

/** Ephemeral client secret lifetime. The OpenAI API key never leaves the server. */
export const CLIENT_SECRET_TTL_SECONDS = 600

export function realtimeVoice(
  raw = process.env.OPENAI_REALTIME_VOICE
): RealtimeVoice {
  return REALTIME_VOICES.includes(raw as RealtimeVoice)
    ? (raw as RealtimeVoice)
    : DEFAULT_REALTIME_VOICE
}

export function realtimeModel(raw = process.env.OPENAI_REALTIME_MODEL): string {
  const trimmed = raw?.trim()
  return trimmed || DEFAULT_REALTIME_MODEL
}

type PromptChatbot = {
  name: string
  description?: string | null
  system_prompt?: string | null
  prompt_notes?: unknown
}

/** Same base the written chat sends: assistant prompt, team notes, entity type. */
export function libraryInstructions(
  chatbot: PromptChatbot,
  entity: string | null
): string {
  return (
    (chatbot.system_prompt?.trim() || buildDefaultSystemPrompt(chatbot)) +
    promptNotesBlock(chatbot.prompt_notes) +
    userContextLine(entity)
  )
}

/**
 * Tools that stay on when navigation is library-only. Anything else on the
 * session is an app-screen tool and is omitted until the user allows it.
 */
const LIBRARY_SAFE_TOOLS = new Set<string>([
  LIBRARY_TOOL_NAME,
  LIST_TOOL_NAME,
  OPEN_TOOL_NAME,
  REMEMBER_TOOL_NAME,
  HANGUP_TOOL_NAME,
])

const LIBRARY_ONLY_LINE =
  "- No abras otras pantallas de la aplicación (chat, biblioteca, historial u otras secciones). Quédate en los documentos: busca, lista y abre uno en la vista previa."

function spokenSpanish(settings: VoiceCallSettings): string {
  const limits = voiceLengthLimits(settings.length)
  const screens = settings.navigation === "app"
  const activeTools = screens
    ? VOICE_TOOL_NAMES
    : VOICE_TOOL_NAMES.filter((name) => LIBRARY_SAFE_TOOLS.has(name))
  const screenLines = screens
    ? `- Para abrir una pantalla (Chat, Biblioteca, Retroalimentación, Uso, Miembros, Historial, Asistente o Perfil), llama a ${NAVIGATE_TOOL_NAME}. No digas que la abriste si la herramienta no lo confirma. La llamada sigue.
- Para cuántas personas hay, preguntas recientes, calificaciones o los conteos de la biblioteca, llama a ${APP_TOOL_NAME}. Di solo las cifras que devuelva. Un miembro no ve hilos privados de otras personas.
- Para el resumen de salud de la biblioteca (documentos, listos, atención, sin audiencia, índice débil, en el índice y hasta cinco documentos peores), llama a ${LIBRARY_SUMMARY_TOOL_NAME}. Es solo para administradores. Di solo los números que devuelva. Si dice que no hay total de fragmentos, dilo así: no inventes esa cifra. También abre la Biblioteca.`
    : LIBRARY_ONLY_LINE
  return `

# Llamada de voz

- La conversación es únicamente en español de México.
- El usuario habla español. Responde siempre en español, aunque un documento esté en otro idioma.
- No cambies de idioma aunque te lo pidan. Si hablan otro idioma, explica en español que esta llamada es solo en español.
- Acento: español de México. El acento no cambia el idioma.
${limits.speechLine}
- Antes de responder cualquier pregunta sobre normas, datos o documentos, llama a ${LIBRARY_TOOL_NAME}. No contestes con conocimiento propio ni mientras esa herramienta sigue abierta.
- No digas que la búsqueda sigue en proceso ni que estás buscando. No hables la respuesta hasta que la herramienta devuelva un pasaje citado.
- Si la herramienta devuelve citado true, di solo el campo respuesta. Ese texto sale de un pasaje de la biblioteca. Nombra el título. Si un documento está desactualizado, dilo. No agregues datos que no estén ahí.
- Si citado es false, di que no está en la biblioteca y pide reformular. No inventes.
- Para decir qué documentos hay, llama a ${LIST_TOOL_NAME}. No inventes títulos.
- Para mostrar un documento en pantalla, llama a ${OPEN_TOOL_NAME} con su título. No digas que lo abriste si la herramienta no lo confirmó.
- Si el usuario dice su tipo de entidad o pide recordarlo, llama a ${REMEMBER_TOOL_NAME}.
- Si pide colgar, terminar o cortar la llamada, en español o en inglés ("cuelga", "adiós", "hasta luego", "chao", "terminar la llamada", "end the call"), llama a ${HANGUP_TOOL_NAME} y deja de hablar. Una despedida seguida de una pregunta no cuelga.
${screenLines}
- Si preguntan qué puedes hacer, qué herramientas tienes, what can you do o what tools do you have, responde en español corto y solo con esto: ${spokenCapabilities(activeTools)} No inventes herramientas y no llames a otra.
- Un saludo no necesita búsqueda.
- Esta sección solo cambia cómo se dice la respuesta. Siguen vigentes las reglas de la biblioteca y del contexto del usuario.`
}

/** Instructions bound to the Realtime session (Spanish speech + the assistant prompt). */
export function buildVoiceInstructions(
  chatbot: PromptChatbot,
  entity: string | null,
  settings: VoiceCallSettings = DEFAULT_VOICE_CALL_SETTINGS
): string {
  return libraryInstructions(chatbot, entity) + spokenSpanish(settings)
}

/** Instructions for the file_search answer that the voice will read. */
export function buildSearchInstructions(
  chatbot: PromptChatbot,
  entity: string | null,
  length: VoiceCallSettings["length"] = DEFAULT_VOICE_CALL_SETTINGS.length
): string {
  return (
    libraryInstructions(chatbot, entity) +
    `

# Respuesta para leer en voz alta

- Responde en español.
- Usa solo los documentos recuperados con la búsqueda de archivos.
- Cada cifra, plazo o correo tiene que aparecer en un pasaje recuperado. Si no está, no lo afirmes.
- Cita cada dato con [N] y cierra con "Referencias:" y el título de cada documento.
${voiceLengthLimits(length).sentenceLine}
- Si no está en los documentos, dilo. No inventes.`
  )
}

/** Drops app-screen tools when the user chose library-only. */
export function toolsForNavigation<T extends { name: string }>(
  tools: T[],
  navigation: VoiceNavigation
): T[] {
  if (navigation === "app") return tools
  return tools.filter((tool) => LIBRARY_SAFE_TOOLS.has(tool.name))
}

interface ToolProperty {
  type: "string" | "boolean"
  description: string
}

interface ToolParameters {
  type: "object"
  additionalProperties: false
  properties: Record<string, ToolProperty>
  required: string[]
}

interface RealtimeFunctionTool {
  type: "function"
  name: VoiceToolName
  description: string
  parameters: ToolParameters
}

export interface RealtimeSessionConfig {
  type: "realtime"
  model: string
  instructions: string
  tools: RealtimeFunctionTool[]
  tool_choice: "auto"
  audio: {
    input: {
      noise_reduction: { type: "near_field" }
      transcription: { model: "gpt-4o-transcribe"; language: "es"; prompt: string }
      turn_detection: {
        type: "semantic_vad"
        eagerness: "medium"
        create_response: true
        interrupt_response: true
      }
    }
    output: { voice: RealtimeVoice }
  }
}

function emptyParameters(): ToolParameters {
  return {
    type: "object",
    additionalProperties: false,
    properties: {},
    required: [],
  }
}

function rememberDescription(entityOptions: string[]): string {
  const listed = entityOptions.filter((option) => option.trim()).join(", ")
  const options = listed
    ? ` Opciones válidas: ${listed}.`
    : " Este asistente puede no tener tipos de entidad configurados."
  return `Guarda el tipo de entidad (perfil) del usuario para las próximas búsquedas.${options}`
}

/** Session minted for the browser. Transcription and speech are pinned to Spanish. */
export function buildRealtimeSession(input: {
  instructions: string
  voice?: RealtimeVoice
  model?: string
  entityOptions?: string[]
  navigation?: VoiceNavigation
}): RealtimeSessionConfig {
  const tools: RealtimeFunctionTool[] = [
      {
        type: "function",
        name: LIBRARY_TOOL_NAME,
        description:
          "Busca en la biblioteca de este asistente, el mismo índice que el chat. Úsala antes de contestar normas, datos o documentos. No hables la respuesta hasta que devuelva citado true con un pasaje. Si citado es false, di que no está. No inventes.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            consulta: {
              type: "string",
              description:
                "Pregunta del usuario, en español, para buscar en la biblioteca.",
            },
            todos_los_documentos: {
              type: "boolean",
              description:
                "true solo si el usuario pide explícitamente buscar en todos los documentos, sin filtrar por su tipo de entidad.",
            },
          },
          required: ["consulta", "todos_los_documentos"],
        },
      },
      {
        type: "function",
        name: LIST_TOOL_NAME,
        description:
          "Lista los documentos de esta biblioteca (títulos). Úsala cuando pregunten qué hay, cuántos documentos hay o pidan la lista. No inventes títulos.",
        parameters: emptyParameters(),
      },
      {
        type: "function",
        name: OPEN_TOOL_NAME,
        description:
          "Abre en pantalla un documento de la biblioteca a partir de su título, por ejemplo uno que acabas de citar. No digas que se abrió si esta herramienta no lo confirma.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            titulo: {
              type: "string",
              description: "Título del documento en la biblioteca, lo más cercano posible al nombre del archivo.",
            },
          },
          required: ["titulo"],
        },
      },
      {
        type: "function",
        name: REMEMBER_TOOL_NAME,
        description: rememberDescription(input.entityOptions ?? []),
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            perfil: {
              type: "string",
              description: "Tipo de entidad que el usuario quiere que recuerdes, por ejemplo bancos o sofipos.",
            },
          },
          required: ["perfil"],
        },
      },
      {
        type: "function",
        name: NAVIGATE_TOOL_NAME,
        description:
          "Abre una pantalla de la aplicación sin colgar: chat, biblioteca, retroalimentacion, uso, miembros, historial, asistente o perfil. No digas que se abrió si no lo confirmas.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            pantalla: {
              type: "string",
              description:
                "Una de: chat, biblioteca, retroalimentacion, uso, miembros, historial, asistente, perfil.",
            },
          },
          required: ["pantalla"],
        },
      },
      {
        type: "function",
        name: APP_TOOL_NAME,
        description:
          "Lee cifras que esta persona puede ver: miembros del equipo, preguntas recientes, retroalimentación (calificaciones, bajas, sin fuentes) o conteos de la biblioteca. Un miembro no recibe hilos de otras personas. Di solo el JSON devuelto.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            dato: {
              type: "string",
              description: "Uno de: miembros, preguntas, retroalimentacion, salud.",
            },
          },
          required: ["dato"],
        },
      },
      {
        type: "function",
        name: LIBRARY_SUMMARY_TOOL_NAME,
        description:
          "Resumen de salud de la biblioteca para un administrador, leído de GET /api/files/summary: documentos, listos, necesitan atención, sin audiencia, índice débil, archivos en el índice y hasta cinco documentos peores. El total de fragmentos viene null porque el índice no lo publica: dilo, no lo inventes. Abre la Biblioteca.",
        parameters: emptyParameters(),
      },
      {
        type: "function",
        name: HANGUP_TOOL_NAME,
        description:
          "Cuelga y termina la llamada. Úsala cuando digan cuelga, colgar, termina la llamada, end the call, adiós, hasta luego o chao, y no hagan otra pregunta. Después de llamarla, no hables más.",
        parameters: emptyParameters(),
      },
  ]
  return {
    type: "realtime",
    model: input.model ?? realtimeModel(),
    instructions: input.instructions,
    tools: toolsForNavigation(
      tools,
      input.navigation ?? DEFAULT_VOICE_CALL_SETTINGS.navigation
    ),
    tool_choice: "auto",
    audio: {
      input: {
        noise_reduction: { type: "near_field" },
        transcription: {
          model: "gpt-4o-transcribe",
          language: "es",
          prompt:
            "Conversation about a private document library. Search the documents and cite passages.",
        },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "medium",
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: input.voice ?? realtimeVoice() },
    },
  }
}

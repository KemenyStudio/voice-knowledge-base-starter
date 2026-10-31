import { foldText } from "@/lib/audience"

import { isHangupUtterance } from "@/lib/voice/hangup"
import { type VoiceScreenId } from "@/lib/voice/screens"

export type AppDatum = "miembros" | "preguntas" | "retroalimentacion" | "salud"

export type VoiceCommand =
  | { type: "hangup" }
  | { type: "capabilities" }
  | { type: "navigate"; screen: VoiceScreenId }
  | { type: "app"; dato: AppDatum; screen: VoiceScreenId }
  | { type: "library-summary" }

const NAVIGATION: Array<{ screen: VoiceScreenId; phrases: string[] }> = [
  {
    screen: "chat",
    phrases: ["abre el chat", "abrir el chat", "abrir chat", "open the chat", "open chat", "muestra el chat"],
  },
  {
    screen: "biblioteca",
    phrases: [
      "abre la biblioteca",
      "abrir la biblioteca",
      "abrir biblioteca",
      "open the library",
      "open library",
      "muestra la biblioteca",
    ],
  },
  {
    screen: "retroalimentacion",
    phrases: [
      "abre la retroalimentacion",
      "abrir retroalimentacion",
      "abre retroalimentacion",
      "open feedback",
      "muestra la retroalimentacion",
    ],
  },
  {
    screen: "uso",
    phrases: ["abre el uso", "abre uso", "abrir uso", "open usage", "muestra el uso"],
  },
  {
    screen: "miembros",
    phrases: [
      "open members",
      "open the members",
      "abre los miembros",
      "abre miembros",
      "abrir miembros",
      "muestra los miembros",
    ],
  },
  {
    screen: "historial",
    phrases: [
      "abre el historial",
      "abrir historial",
      "abre historial",
      "open history",
      "muestra el historial",
    ],
  },
  {
    screen: "asistente",
    phrases: [
      "abre el asistente",
      "abrir asistente",
      "abre asistente",
      "open assistant settings",
      "open the assistant",
      "muestra el asistente",
    ],
  },
  {
    screen: "perfil",
    phrases: [
      "abre el perfil",
      "abre mi perfil",
      "abre perfil",
      "abrir perfil",
      "open my profile",
      "open profile",
      "muestra el perfil",
    ],
  },
]

function folded(text: string): string {
  return foldText(text).replace(/[¡!¿?.,;:]/g, "").replace(/\s+/g, " ").trim()
}

function includes(text: string, phrase: string): boolean {
  return text === phrase || text.includes(phrase)
}

/**
 * Spoken commands that run even if the model does not call a tool.
 * A farewell that continues into a question is not a hang-up: isHangupUtterance
 * rejects those before this list is checked.
 */
export function matchVoiceCommand(text: string): VoiceCommand | null {
  if (isHangupUtterance(text)) return { type: "hangup" }
  const textFolded = folded(text)
  if (!textFolded) return null

  if (
    includes(textFolded, "que puedes hacer") ||
    includes(textFolded, "que herramientas tienes") ||
    includes(textFolded, "what can you do") ||
    includes(textFolded, "what tools do you have")
  ) {
    return { type: "capabilities" }
  }

  if (
    includes(textFolded, "salud de la biblioteca") ||
    includes(textFolded, "estado de la biblioteca") ||
    includes(textFolded, "resumen de la biblioteca") ||
    includes(textFolded, "library health") ||
    includes(textFolded, "cuantos fragmentos") ||
    includes(textFolded, "how many chunks") ||
    includes(textFolded, "etiquetas faltantes") ||
    includes(textFolded, "missing labels") ||
    includes(textFolded, "indice debil") ||
    includes(textFolded, "weak index")
  ) {
    return { type: "library-summary" }
  }

  if (
    includes(textFolded, "cuantos usuarios") ||
    includes(textFolded, "cuantas personas") ||
    includes(textFolded, "cuantos miembros") ||
    includes(textFolded, "how many users") ||
    includes(textFolded, "how many people") ||
    includes(textFolded, "how many members")
  ) {
    return { type: "app", dato: "miembros", screen: "miembros" }
  }

  if (
    includes(textFolded, "preguntas recientes") ||
    includes(textFolded, "que han preguntado") ||
    includes(textFolded, "recent questions")
  ) {
    return { type: "app", dato: "preguntas", screen: "historial" }
  }

  if (
    includes(textFolded, "resumen de retroalimentacion") ||
    includes(textFolded, "calificaciones") ||
    includes(textFolded, "low ratings") ||
    includes(textFolded, "respuestas sin fuentes") ||
    includes(textFolded, "sin fuentes") ||
    includes(textFolded, "answers without sources")
  ) {
    return { type: "app", dato: "retroalimentacion", screen: "retroalimentacion" }
  }

  let best: { screen: VoiceScreenId; length: number } | null = null
  for (const row of NAVIGATION) {
    for (const phrase of row.phrases) {
      if (includes(textFolded, phrase) && (!best || phrase.length > best.length)) {
        best = { screen: row.screen, length: phrase.length }
      }
    }
  }
  if (best) return { type: "navigate", screen: best.screen }
  return null
}

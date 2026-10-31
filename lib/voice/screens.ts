/** Screens the call can open. `view` is the id ChatbotPageClient already uses. */
export const VOICE_SCREENS = [
  { id: "chat", view: "chat", label: "Chat", adminOnly: false },
  { id: "biblioteca", view: "biblioteca", label: "Biblioteca", adminOnly: false },
  { id: "retroalimentacion", view: "feedback", label: "Retroalimentación", adminOnly: true },
  { id: "uso", view: "usage", label: "Uso", adminOnly: true },
  { id: "miembros", view: "TeamPageClient", label: "Miembros", adminOnly: true },
  { id: "historial", view: "history", label: "Historial", adminOnly: false },
  { id: "asistente", view: "assistant", label: "Asistente", adminOnly: true },
  { id: "perfil", view: "profile", label: "Perfil", adminOnly: false },
] as const

export type VoiceScreenId = (typeof VOICE_SCREENS)[number]["id"]

export type VoiceScreen = (typeof VOICE_SCREENS)[number]

export function screenById(id: string): VoiceScreen | null {
  return VOICE_SCREENS.find((screen) => screen.id === id) ?? null
}

export function screenByView(view: string): VoiceScreen | null {
  return VOICE_SCREENS.find((screen) => screen.view === view) ?? null
}

/** Where an app-data answer should land. Admins see team usage; members see their own history. */
export function viewForAppDatum(
  dato: "miembros" | "preguntas" | "retroalimentacion" | "salud",
  isAdmin: boolean
): string {
  switch (dato) {
    case "miembros":
      return "TeamPageClient"
    case "preguntas":
      return isAdmin ? "usage" : "history"
    case "retroalimentacion":
      return "feedback"
    case "salud":
      return "biblioteca"
    default: {
      const unreachable: never = dato
      return unreachable
    }
  }
}

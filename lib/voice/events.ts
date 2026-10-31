export type VoiceChannelEvent =
  | { kind: "user-delta"; id: string; delta: string }
  | { kind: "user-done"; id: string; text: string }
  | { kind: "assistant-delta"; id: string; delta: string }
  | { kind: "assistant-done"; id: string; text: string }
  | { kind: "tool"; callId: string; name: string; arguments: string }
  | { kind: "response-started"; id: string }
  | { kind: "response-finished"; id: string }
  | { kind: "response-busy" }
  | { kind: "error"; message: string }
  | { kind: "ignore" }

function text(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function responseId(event: Record<string, unknown>): string {
  const response = event.response
  if (response && typeof response === "object") {
    return text((response as { id?: unknown }).id)
  }
  return text(event.response_id)
}

/** Maps a Realtime data-channel event into the few cases the call UI handles. */
export function classifyVoiceEvent(raw: unknown): VoiceChannelEvent {
  if (!raw || typeof raw !== "object") return { kind: "ignore" }
  const event = raw as Record<string, unknown>
  const type = event.type
  const id = text(event.item_id)

  switch (type) {
    case "conversation.item.input_audio_transcription.delta":
      return { kind: "user-delta", id, delta: text(event.delta) }
    case "conversation.item.input_audio_transcription.completed":
      return { kind: "user-done", id, text: text(event.transcript) }
    case "response.output_audio_transcript.delta":
      return { kind: "assistant-delta", id, delta: text(event.delta) }
    case "response.output_audio_transcript.done":
      return { kind: "assistant-done", id, text: text(event.transcript) }
    case "response.function_call_arguments.done":
      return {
        kind: "tool",
        callId: text(event.call_id),
        name: text(event.name),
        arguments: text(event.arguments),
      }
    case "response.created":
      return { kind: "response-started", id: responseId(event) }
    case "response.done":
    case "response.cancelled":
      return { kind: "response-finished", id: responseId(event) }
    case "error": {
      const err = event.error
      const message =
        err && typeof err === "object"
          ? text((err as { message?: unknown }).message)
          : ""
      if (/active response/i.test(message)) return { kind: "response-busy" }
      return {
        kind: "error",
        message: (message || "Error de la llamada").slice(0, 300),
      }
    }
    default:
      return { kind: "ignore" }
  }
}

/** One string argument from a tool payload. Empty when the JSON has no such field. */
export function toolStringArg(raw: string, key: string): string {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return text(parsed[key]).trim().slice(0, 8000)
  } catch {
    return ""
  }
}

/** Arguments of buscar_biblioteca. A broken payload still yields a search string. */
export function consultaFromToolArgs(raw: string): {
  consulta: string
  searchAll: boolean
} {
  try {
    const parsed = JSON.parse(raw) as {
      consulta?: unknown
      todos_los_documentos?: unknown
    }
    const consulta = text(parsed.consulta).trim()
    if (!consulta) return { consulta: raw.trim().slice(0, 8000), searchAll: false }
    return {
      consulta: consulta.slice(0, 8000),
      searchAll: parsed.todos_los_documentos === true,
    }
  } catch {
    return { consulta: raw.trim().slice(0, 8000), searchAll: false }
  }
}

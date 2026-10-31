/** How long the spoken answer should be. Maps to the existing text verbosity and max output. */
export const VOICE_LENGTHS = ["breve", "normal", "detallada"] as const

export type VoiceLength = (typeof VOICE_LENGTHS)[number]

/** App screens, or the library only. Default is app, which is today's behavior until screen tools exist. */
export const VOICE_NAVIGATIONS = ["app", "library"] as const

export type VoiceNavigation = (typeof VOICE_NAVIGATIONS)[number]

export type VoiceVerbosity = "low" | "medium" | "high"

export interface VoiceCallSettings {
  length: VoiceLength
  navigation: VoiceNavigation
}

export const DEFAULT_VOICE_CALL_SETTINGS: VoiceCallSettings = {
  length: "normal",
  navigation: "app",
}

export interface VoiceLengthLimits {
  verbosity: VoiceVerbosity
  /** Cap before the assistant-wide max output is applied. Normal matches the current voice search. */
  maxOutputTokens: number
  /** Replaces the speech-length line in the Realtime instructions. */
  speechLine: string
  /** Replaces the sentence cap in the library answer the voice reads. */
  sentenceLine: string
}

const BREVE: VoiceLengthLimits = {
  verbosity: "low",
  maxOutputTokens: 700,
  speechLine:
    '- Responde en una o dos frases, para ser escuchadas. No leas markdown, corchetes ni una sección titulada "Referencias".',
  sentenceLine:
    "- Como máximo tres oraciones antes de las referencias, para que se pueda decir en voz alta.",
}

const NORMAL: VoiceLengthLimits = {
  verbosity: "low",
  maxOutputTokens: 2000,
  speechLine:
    '- Habla en frases cortas, para ser escuchadas. No leas markdown, corchetes ni una sección titulada "Referencias".',
  sentenceLine:
    "- Como máximo ocho oraciones antes de las referencias, para que se pueda decir en voz alta.",
}

const DETALLADA: VoiceLengthLimits = {
  verbosity: "high",
  maxOutputTokens: 8000,
  speechLine:
    '- Puedes desarrollar la respuesta, en frases que se puedan escuchar. No leas markdown, corchetes ni una sección titulada "Referencias".',
  sentenceLine:
    "- Puedes usar hasta dieciséis oraciones antes de las referencias, solo con lo que esté en los documentos.",
}

export function voiceLengthLimits(length: VoiceLength): VoiceLengthLimits {
  switch (length) {
    case "breve":
      return BREVE
    case "normal":
      return NORMAL
    case "detallada":
      return DETALLADA
    default: {
      const unreachable: never = length
      return unreachable
    }
  }
}

/** Verbosity and max output for the library answer, still bounded by the assistant-wide cap. */
export function voiceSearchGeneration(
  length: VoiceLength,
  maxOutputCap: number
): { verbosity: VoiceVerbosity; max_output_tokens: number } {
  const limits = voiceLengthLimits(length)
  return {
    verbosity: limits.verbosity,
    max_output_tokens: Math.min(maxOutputCap, limits.maxOutputTokens),
  }
}

export function parseVoiceLength(value: unknown): VoiceLength {
  return value === "breve" || value === "normal" || value === "detallada" ? value : "normal"
}

export function parseVoiceNavigation(value: unknown): VoiceNavigation {
  return value === "library" || value === "app" ? value : "app"
}

export function parseVoiceCallSettings(row: {
  voice_length?: unknown
  voice_navigation?: unknown
} | null | undefined): VoiceCallSettings {
  if (!row) return DEFAULT_VOICE_CALL_SETTINGS
  return {
    length: parseVoiceLength(row.voice_length),
    navigation: parseVoiceNavigation(row.voice_navigation),
  }
}

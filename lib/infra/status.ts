import { emailFromAddress } from "@/lib/emails"
import { loadMcpKeys } from "@/lib/mcp/auth"
import {
  DEFAULT_REALTIME_MODEL,
  realtimeVoice,
} from "@/lib/voice/instructions"

const ANSWER_MODEL = "gpt-6-luna"
const METADATA_MODEL = "gpt-6-astra"
const COMPUTER_MODEL = "gpt-6-astra"
const TRANSCRIPTION_MODEL = "gpt-4o-transcribe"

/** Rejects values that look like credentials. The pieces are joined so the source has no key prefix. */
const CREDENTIAL_SHAPE = new RegExp(
  ["sk", "eyJ", "re_", "bearer", "secret", "supabase", "https?:", "api[_-]?key"].join("|"),
  "i"
)

export type InfraConnectionStatus = "present" | "missing" | "misconfigured"

export interface InfraConnection {
  id: string
  name: string
  purpose: string
  status: InfraConnectionStatus
  statusLabel: string
  lines: string[]
}

export interface InfraStatus {
  connections: InfraConnection[]
}

function filled(value: string | undefined): boolean {
  return Boolean(value?.trim())
}

/**
 * Model ids named in code or set as a short model name. Anything that looks
 * like a key, token, or URL is replaced with the code default.
 */
export function publicModelId(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim() ?? ""
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,63}$/.test(trimmed)) return fallback
  if (CREDENTIAL_SHAPE.test(trimmed)) {
    return fallback
  }
  return trimmed
}

function supabaseRef(url: string | undefined): string | null {
  if (!url?.trim()) return null
  try {
    const host = new URL(url).hostname.toLowerCase()
    const match = /^([a-z0-9]{20})\.supabase\.co$/.exec(host)
    return match ? match[1] : null
  } catch {
    return null
  }
}

function bucketName(value: string | undefined): string {
  const trimmed = value?.trim() || "knowledge"
  return /^[a-z0-9][a-z0-9_-]{0,48}$/i.test(trimmed) ? trimmed : "knowledge"
}

function vercelEnv(value: string | undefined): string | null {
  if (value === "production" || value === "preview" || value === "development") {
    return value
  }
  return null
}

function keyLine(name: string, ok: boolean): string {
  return ok ? `${name} presente` : `${name} ausente`
}

/**
 * What this process is configured to call. Booleans and public model ids only.
 * Callers must not pass the result through a logger that also prints `env`.
 */
export function buildInfraStatus(env: NodeJS.ProcessEnv): InfraStatus {
  const urlOk = filled(env.NEXT_PUBLIC_SUPABASE_URL)
  const anonOk = filled(env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
  const serviceOk = filled(env.SUPABASE_SERVICE_ROLE_KEY)
  const supabaseOk = urlOk && anonOk && serviceOk
  const ref = supabaseRef(env.NEXT_PUBLIC_SUPABASE_URL)
  const project = ref
    ? "Proyecto de Supabase"
    : urlOk
      ? "URL presente"
      : "URL ausente"

  const openaiOk = filled(env.OPENAI_API_KEY)
  const answer = publicModelId(env.OPENAI_MODEL_ANSWER, ANSWER_MODEL)
  const utility = publicModelId(
    env.OPENAI_MODEL_UTILITY || env.OPENAI_MODEL_ANSWER,
    answer
  )
  const metadata = publicModelId(env.OPENAI_MODEL_METADATA, METADATA_MODEL)
  const computer = publicModelId(env.OPENAI_MODEL_COMPUTER, COMPUTER_MODEL)
  const voice = realtimeVoice(env.OPENAI_REALTIME_VOICE)
  const realtime = publicModelId(env.OPENAI_REALTIME_MODEL, DEFAULT_REALTIME_MODEL)
  const fixtureOn = env.COMPUTER_USE_FIXTURE === "1"
  const isolatedStore = filled(env.COMPUTER_USE_VECTOR_STORE)

  const resendOk = filled(env.RESEND_API_KEY)
  const mcp = loadMcpKeys(env)
  const mcpStatus: InfraConnectionStatus = mcp.ok
    ? "present"
    : mcp.reason === "misconfigured"
      ? "misconfigured"
      : "missing"

  const onVercel = env.VERCEL === "1"
  const environment = vercelEnv(env.VERCEL_ENV)

  const connections: InfraConnection[] = [
    {
      id: "vercel",
      name: "Next.js en Vercel",
      purpose: "Aplicación y analítica de visitas.",
      status: onVercel ? "present" : "missing",
      statusLabel: onVercel ? "En Vercel" : "Fuera de Vercel",
      lines: [
        onVercel ? "Variable VERCEL presente" : "Variable VERCEL ausente",
        environment ? `Entorno ${environment}` : "Entorno no indicado",
        "Analítica de Vercel en el layout",
      ],
    },
    {
      id: "supabase",
      name: "Supabase",
      purpose: "Cuentas, equipos, historial y archivos originales.",
      status: supabaseOk ? "present" : "missing",
      statusLabel: supabaseOk ? "Configurado" : "Incompleto",
      lines: [
        project,
        keyLine("Clave anónima", anonOk),
        keyLine("Service role", serviceOk),
        `Bucket ${bucketName(env.SUPABASE_STORAGE_BUCKET)}`,
      ],
    },
    {
      id: "openai",
      name: "OpenAI",
      purpose: "Respuestas, índice, voz, metadatos y búsqueda web.",
      status: openaiOk ? "present" : "missing",
      statusLabel: openaiOk ? "Clave presente" : "Sin clave",
      lines: [
        keyLine("OPENAI_API_KEY", openaiOk),
        `Respuestas: ${answer} · file_search`,
        `Metadatos: ${metadata}`,
        `Tareas cortas: ${utility} · seguimientos, audiencia, plan de investigación, obligaciones`,
        `Voz: ${realtime} · ${voice} · transcripción ${TRANSCRIPTION_MODEL}`,
        `Búsqueda web: web_search · sitios oficiales de México · ${answer}`,
        `Herramientas: correo, memorando y vigencia · ${answer}`,
        `Computer use: harness local · ${computer} · ${
          fixtureOn ? "activo en loopback" : "apagado en esta instancia"
        }${isolatedStore ? " · índice aislado" : ""}`,
      ],
    },
    {
      id: "resend",
      name: "Resend",
      purpose: "Invitaciones, alertas de la biblioteca y avisos de retroalimentación.",
      status: resendOk ? "present" : "missing",
      statusLabel: resendOk ? "Clave presente" : "Sin clave",
      lines: [keyLine("RESEND_API_KEY", resendOk), `Remitente ${emailFromAddress(env)}`],
    },
    {
      id: "mcp",
      name: "MCP",
      purpose: "Otros agentes leen la biblioteca de un equipo.",
      status: mcpStatus,
      statusLabel:
        mcpStatus === "present"
          ? "Configurado"
          : mcpStatus === "misconfigured"
            ? "Revisar"
            : "Sin clave",
      lines: [
        mcp.ok
          ? `${mcp.keys.length === 1 ? "1 equipo" : `${mcp.keys.length} equipos`}`
          : mcp.reason === "misconfigured"
            ? "MCP_API_KEY, MCP_TEAM_ID o MCP_API_KEYS no son válidos"
            : "MCP_API_KEY ausente",
        "POST /api/mcp",
        "Lee el índice. No redacta la respuesta.",
      ],
    },
  ]

  return { connections }
}

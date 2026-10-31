import { aiConfig, getOpenAI } from "@/lib/openai"
import {
  proposalFromReading,
  type DocumentMetadataProposal,
} from "@/lib/knowledge/document-metadata"
import type { AudienceReading } from "@/lib/knowledge/audience-label"

const MIN_TEXT = 40

interface ModelMetadata {
  nombre: string
  tipo: string
  limited_to_known_profiles: boolean
  known_profiles: string[]
  other_audiences: string[]
  fuente: string[]
  contexto: string
}

function schema(options: string[]) {
  const knownProfiles =
    options.length > 0
      ? { type: "array", items: { type: "string", enum: options } }
      : { type: "array", items: { type: "string" } }
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "nombre",
      "tipo",
      "limited_to_known_profiles",
      "known_profiles",
      "other_audiences",
      "fuente",
      "contexto",
    ],
    properties: {
      nombre: { type: "string" },
      tipo: { type: "string" },
      limited_to_known_profiles: { type: "boolean" },
      known_profiles: knownProfiles,
      other_audiences: { type: "array", items: { type: "string" } },
      fuente: { type: "array", items: { type: "string" } },
      contexto: { type: "string" },
    },
  }
}

/**
 * Asks gpt-6-astra for document metadata. Nothing is stored here.
 * Returns null when the text is too short or the model reply is not usable.
 */
export async function proposeDocumentMetadata(input: {
  fileName: string
  text: string
  options: string[]
  knownLabels: string[]
  knownTypes: string[]
}): Promise<DocumentMetadataProposal | null> {
  const text = input.text.replace(/\s+/g, " ").trim().slice(0, 12_000)
  if (text.length < MIN_TEXT) return null

  const profiles =
    input.options.length > 0
      ? input.options.join("; ")
      : "(ninguno configurado: deja known_profiles vacío)"
  const used = input.knownLabels.filter(Boolean).slice(0, 40).join("; ") || "(ninguna)"
  const types = input.knownTypes.filter(Boolean).slice(0, 24).join("; ") || "(ninguno)"

  const response = await getOpenAI().responses.create({
    model: aiConfig.metadataModel,
    reasoning: { effort: aiConfig.metadataEffort },
    store: false,
    max_output_tokens: 2000,
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "document_metadata",
        strict: true,
        schema: schema(input.options),
      },
    },
    instructions: `Lees el texto de un documento y propones sus metadatos en español.
No inventes un dato que el texto no sostenga.

nombre: título breve, sin extensión.

tipo: el tipo real del documento (Ley, Circular, Disposición, Manual, Guía, Contrato, Informe, Anexo, Presentación, Nota u otro). Tipos ya usados: ${types}. Si uno coincide, usa esa redacción. Si ninguno corresponde, escribe el tipo real. No fuerces un tipo parecido.

audiencia:
- Perfiles configurados: ${profiles}.
- Etiquetas ya usadas en la biblioteca: ${used}.
- known_profiles: solo perfiles de la lista configurada que el texto nombra como destinatarios. No uses un perfil parecido para otro grupo.
- other_audiences: el nombre real de quien no está en la lista. Reutiliza la etiqueta ya usada cuando es la misma audiencia. No pongas el tipo de documento aquí.
- limited_to_known_profiles es true solo si el documento se dirige exclusivamente a known_profiles. Si también alcanza a otro grupo, o es general, pon false y nombra a la audiencia real en other_audiences.
- Si el texto no dice a quién va dirigido, deja las dos listas vacías y limited_to_known_profiles en false. Una etiqueta incorrecta es peor que ninguna.

fuente: organismo o publicación de origen que el texto nombre. Vacío si no aparece.

contexto: de 2 a 4 frases, máximo 450 caracteres, sobre de qué trata y a quién obliga. Sin viñetas.`,
    input: `Documento: ${input.fileName}\n\nTexto:\n${text}`,
  })

  try {
    const parsed = JSON.parse(response.output_text) as ModelMetadata
    const reading: AudienceReading = {
      knownProfiles: parsed.known_profiles ?? [],
      limitedToKnownProfiles: Boolean(parsed.limited_to_known_profiles),
      otherAudiences: parsed.other_audiences ?? [],
      reason: "",
    }
    return proposalFromReading({
      nombre: parsed.nombre ?? "",
      tipo: parsed.tipo ?? "",
      fuente: parsed.fuente ?? [],
      contexto: parsed.contexto ?? "",
      reading,
      options: input.options,
      knownLabels: [...input.options, ...input.knownLabels],
      knownTypes: input.knownTypes,
    })
  } catch {
    return null
  }
}

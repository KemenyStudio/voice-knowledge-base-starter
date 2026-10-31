import { aiConfig, getOpenAI } from "@/lib/openai"
import { vectorSearchRanking } from "@/lib/retrieval"
import type { AudienceReading } from "@/lib/knowledge/audience-label"

/**
 * Reads the passages of one document that describe its scope and returns who
 * it is directed at. Nothing is stored here.
 */
export async function suggestAudience(input: {
  vectorStoreId: string
  fileRowId: string
  fileName: string
  options: string[]
}): Promise<AudienceReading | null> {
  const openai = getOpenAI()

  const found = await openai.vectorStores.search(input.vectorStoreId, {
    query:
      "ámbito de aplicación, sujetos obligados y a quién va dirigido este documento",
    filters: { type: "eq", key: "file_row_id", value: input.fileRowId },
    max_num_results: 6,
    rewrite_query: true,
    ranking_options: vectorSearchRanking(),
  })
  const passages = found.data
    .flatMap((hit) => hit.content.map((part) => part.text))
    .join("\n---\n")
    .slice(0, 9000)
  if (!passages.trim()) return null

  const response = await openai.responses.create({
    model: aiConfig.utilityModel,
    reasoning: { effort: aiConfig.utilityEffort },
    store: false,
    max_output_tokens: 700,
    text: {
      verbosity: "low",
      format: {
        type: "json_schema",
        name: "audience",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: [
            "limited_to_known_profiles",
            "known_profiles",
            "other_audiences",
            "reason",
          ],
          properties: {
            limited_to_known_profiles: { type: "boolean" },
            known_profiles: {
              type: "array",
              items: { type: "string", enum: input.options },
            },
            other_audiences: {
              type: "array",
              items: { type: "string" },
            },
            reason: { type: "string" },
          },
        },
      },
    },
    instructions: `Clasificas a quién va dirigido un documento del sistema financiero mexicano.
Perfiles ya configurados: ${input.options.join("; ")}.
- known_profiles: solo perfiles de esa lista que el documento nombra como destinatarios. No uses un perfil parecido para otro sector. Banco de México no es Bancos. Una casa de cambio no es una casa de bolsa. Una unión de crédito, una sofipo y una cooperativa de ahorro y préstamo son distintas. Un fondo de inversión no es un banco.
- other_audiences: nombres cortos en español de los destinatarios que no están en la lista (otro sector, o el sujeto de una ley más amplia). Cada nombre dice a quién va dirigido, no el tipo de documento. Ejemplos: "Casas de cambio", "Uniones de crédito", "Instituciones de seguros", "Banco de México", "Sociedades cooperativas de ahorro y préstamo". Máximo 4.
- limited_to_known_profiles es true solo si el documento se dirige exclusivamente a known_profiles y a nadie más. Si también alcanza a otro sector, o es una ley orgánica o general, pon false.
- Si limited_to_known_profiles es false, other_audiences no puede quedar vacío: nombra a la audiencia real.
- En la duda, limited_to_known_profiles es false. Ocultar un documento por error es peor que mostrarlo de más.
- reason: una frase corta (máx. 160 caracteres) con la evidencia del texto.`,
    input: `Documento: ${input.fileName}\n\nPasajes sobre su ámbito:\n${passages}`,
  })

  try {
    const parsed = JSON.parse(response.output_text) as {
      limited_to_known_profiles: boolean
      known_profiles: string[]
      other_audiences: string[]
      reason: string
    }
    return {
      knownProfiles: parsed.known_profiles ?? [],
      limitedToKnownProfiles: Boolean(parsed.limited_to_known_profiles),
      otherAudiences: parsed.other_audiences ?? [],
      reason: String(parsed.reason ?? ""),
    }
  } catch {
    return null
  }
}

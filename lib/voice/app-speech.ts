export type AppDatum = "miembros" | "preguntas" | "retroalimentacion" | "salud"

const QUESTION_LIMIT = 5

function countLabel(value: number, one: string, many: string): string {
  return `${value} ${value === 1 ? one : many}`
}

export function speakMemberCount(input: {
  total: number
  admins: number | null
}): string {
  const total = countLabel(input.total, "persona", "personas")
  if (input.admins == null) {
    return `Hay ${total} en el equipo.`
  }
  const members = Math.max(0, input.total - input.admins)
  return `Hay ${total} en el equipo: ${countLabel(input.admins, "administrador", "administradores")} y ${countLabel(members, "miembro", "miembros")}.`
}

export function speakQuestions(input: {
  total: number
  scope: "team" | "own"
  items: string[]
}): string {
  const whose = input.scope === "team" ? "del equipo" : "tuyas"
  if (input.total === 0) return `No hay preguntas recientes ${whose}.`
  const listed = input.items.filter(Boolean).slice(0, QUESTION_LIMIT)
  const preview = listed.length ? ` Las más recientes: ${listed.join(". ")}.` : ""
  return `Hay ${countLabel(input.total, "pregunta reciente", "preguntas recientes")} ${whose}.${preview}`
}

export function speakFeedback(input: {
  ratings: number
  low: number
  withoutSources: number
  scope: "team" | "own"
}): string {
  const whose = input.scope === "team" ? "del equipo" : "tuyas"
  return `Retroalimentación ${whose}: ${countLabel(input.ratings, "calificación", "calificaciones")}, ${countLabel(input.low, "calificación baja", "calificaciones bajas")} y ${countLabel(input.withoutSources, "respuesta sin fuentes", "respuestas sin fuentes")}.`
}

export function speakLibraryCounts(input: {
  documents: number
  ready: number
  attention: number
  missingLabels: number
}): string {
  return `En la biblioteca hay ${countLabel(input.documents, "documento", "documentos")}: ${countLabel(input.ready, "listo", "listos")}, ${countLabel(input.attention, "que requiere atención", "que requieren atención")} y ${countLabel(input.missingLabels, "sin etiquetas", "sin etiquetas")}.`
}

export function excerpt(value: string, max = 140): string {
  const clean = value.replace(/\s+/g, " ").trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

export type DocumentAction = "summarize" | "compare" | "changes"

export interface FocusDocument {
  id: string
  title: string
}

/** Number of documents each action works on. */
export const ACTION_DOCUMENTS: Record<DocumentAction, number> = {
  summarize: 1,
  compare: 2,
  changes: 2,
}

/** Search filter limiting file_search to the given Library documents. */
export function focusFilter(ids: string[]) {
  const equals = ids.map((id) => ({
    type: "eq" as const,
    key: "file_row_id",
    value: id,
  }))
  return equals.length === 1
    ? equals[0]
    : { type: "or" as const, filters: equals }
}

/** The question the user "asks" when picking an action on a source. */
export function actionQuestion(action: DocumentAction, titles: string[]): string {
  const [a, b] = titles
  if (action === "summarize") return `Resume el documento «${a}»`
  if (action === "compare") return `Compara «${a}» con «${b}»`
  return `¿Qué cambió en «${a}» respecto a «${b}»?`
}

/** Extra instructions for the model while an action is running. */
export function focusInstructions(
  action: DocumentAction,
  docs: FocusDocument[]
): string {
  const [a, b] = docs
  const common =
    "Usa solo los pasajes recuperados de estos documentos; si algo no aparece en ellos, dilo en lugar de suponerlo. Cita con [N]. No pidas aclaraciones: responde con lo disponible."
  if (action === "summarize") {
    return `

# Tarea: resumir un documento

Resume el documento «${a.title}». Estructura: 1) qué es y a quién aplica; 2) contenido principal por secciones; 3) obligaciones, plazos y fechas clave; 4) vigencia o fecha de publicación si aparece. ${common}`
  }
  if (action === "compare") {
    return `

# Tarea: comparar dos documentos

Compara «${a.title}» (A) con «${b.title}» (B). Presenta una tabla Markdown con una fila por tema (ámbito, obligaciones, plazos, sanciones, otros que apliquen) y columnas A y B, y después 3 a 5 viñetas con las diferencias clave y las coincidencias. Si un tema no aparece en los pasajes de uno de los documentos, escribe «No aparece en los pasajes revisados». ${common}`
  }
  return `

# Tarea: qué cambió entre dos versiones

«${a.title}» (A) se trata como la versión nueva y «${b.title}» (B) como la anterior; si los textos indican lo contrario, señálalo. Estructura: resumen en dos líneas; tabla «Tema | Antes (B) | Ahora (A)» con obligaciones nuevas, eliminadas o modificadas y cambios de plazos o umbrales; y qué sigue igual. Aclara que la comparación puede ser parcial porque se basa en los pasajes recuperados. ${common}`
}

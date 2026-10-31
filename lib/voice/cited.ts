export interface CitedDocument {
  numero: number
  titulo: string
  extracto: string
  desactualizado: boolean
}

const NOT_IN_PASSAGE =
  "No encontré en la biblioteca un pasaje que contenga eso. Pide reformular la pregunta."

/**
 * Speech comes from retrieved passages, not from the search model's free text
 * and not from the Realtime model. No passage means there is nothing to say.
 */
export function citedLibrarySpeech(documents: CitedDocument[]): {
  respuesta: string
  documentos: CitedDocument[]
  cited: boolean
} {
  const citedDocs = documents.filter((doc) => doc.extracto.trim().length > 0)
  if (citedDocs.length === 0) {
    return { respuesta: NOT_IN_PASSAGE, documentos: [], cited: false }
  }
  const shown = citedDocs.slice(0, 3).map((doc) => ({
    ...doc,
    extracto: doc.extracto.slice(0, 500),
  }))
  const respuesta = shown
    .map(
      (doc) =>
        `${doc.titulo}${doc.desactualizado ? ", desactualizado" : ""}: ${doc.extracto}`
    )
    .join(" ")
  return { respuesta, documentos: shown, cited: true }
}

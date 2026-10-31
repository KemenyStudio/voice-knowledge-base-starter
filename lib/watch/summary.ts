export interface WatchResultCounts {
  skippedScan: boolean
  ingested: number
  already: number
  failed: number
  pending: number
}

function count(n: number, one: string, many: string): string {
  return n === 1 ? one : many.replace("%n", String(n))
}

/** Spanish sentence shown after Buscar documentos nuevos. */
export function watchResultNote(input: WatchResultCounts): string {
  const parts: string[] = []
  if (input.ingested > 0) {
    parts.push(
      count(
        input.ingested,
        "Se agregó 1 documento a la biblioteca.",
        "Se agregaron %n documentos a la biblioteca."
      )
    )
  }
  if (input.already > 0) {
    parts.push(
      count(
        input.already,
        "1 ya estaba en la biblioteca y no se reemplazó.",
        "%n ya estaban en la biblioteca y no se reemplazaron."
      )
    )
  }
  if (input.failed > 0) {
    parts.push(
      count(
        input.failed,
        "1 no se pudo obtener y sigue en la lista.",
        "%n no se pudieron obtener y siguen en la lista."
      )
    )
  }
  const waiting = Math.max(0, input.pending - input.failed)
  if (waiting > 0 && (input.ingested > 0 || input.failed > 0)) {
    parts.push("Quedan documentos por agregar. Vuelve a buscar para continuar.")
  }
  if (parts.length > 0) return parts.join(" ")
  if (input.skippedScan) {
    return "La revisión acaba de correr. Estas son las propuestas vigentes."
  }
  return "No hubo documentos nuevos para agregar."
}

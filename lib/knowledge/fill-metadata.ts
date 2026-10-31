/** Asks the server to fill empty metadata until every pending document was tried once. */
export async function fillEmptyDocumentMetadata(chatbotId: string): Promise<{
  updated: number
  failed: number
  skipped: number
}> {
  const skipIds: string[] = []
  let updated = 0
  let failed = 0
  let skipped = 0
  for (let round = 0; round < 120; round += 1) {
    const response = await fetch("/api/files/metadata", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "fill_empty", chatbotId, skipIds }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        typeof data.error === "string" ? data.error : "No se pudieron completar los metadatos"
      )
    }
    updated += Number(data.updated ?? 0)
    failed += Number(data.failed ?? 0)
    skipped += Number(data.skipped ?? 0)
    const attempted = Array.isArray(data.attemptedIds) ? data.attemptedIds : []
    for (const id of attempted) {
      if (typeof id === "string" && !skipIds.includes(id)) skipIds.push(id)
    }
    if (!data.remaining || attempted.length === 0) break
  }
  return { updated, failed, skipped }
}

export function fillMetadataMessage(result: {
  updated: number
  failed: number
  skipped: number
}): string {
  const filled =
    result.updated === 1
      ? "Astra completó 1 documento."
      : `Astra completó ${result.updated} documentos.`
  const unread =
    result.failed + result.skipped === 0
      ? ""
      : result.failed + result.skipped === 1
        ? " 1 quedó sin cambios porque no se pudo leer."
        : ` ${result.failed + result.skipped} quedaron sin cambios porque no se pudieron leer.`
  return `${filled}${unread} Solo se escribieron los campos vacíos: nombre, tipo, audiencia, fuente y contexto.`
}

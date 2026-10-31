/** Calls the library action until every pending document has been tried. */
export async function labelAudiencesWithAi(
  chatbotId: string
): Promise<{ labeled: number; failed: number }> {
  let labeled = 0
  let failed = 0
  for (let round = 0; round < 40; round += 1) {
    const res = await fetch("/api/files/audience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatbotId, action: "suggest" }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) {
      throw new Error(
        typeof data.error === "string" ? data.error : "No se pudo etiquetar la audiencia"
      )
    }
    const wrote = Number(data.labeled ?? data.suggested ?? 0)
    labeled += wrote
    failed += Number(data.failed ?? 0)
    if (data.remaining === 0 || wrote === 0) break
  }
  return { labeled, failed }
}

export function audienceLabelMessage(labeled: number, failed: number): string {
  const base =
    labeled === 1
      ? "1 documento quedó con audiencia."
      : `${labeled} documentos quedaron con audiencia.`
  if (!failed) return base
  const unread = failed === 1 ? "1 no se pudo leer." : `${failed} no se pudieron leer.`
  return `${base} ${unread}`
}

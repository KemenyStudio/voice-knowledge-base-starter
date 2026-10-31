import type { AnySupabase } from "@/lib/supabase/server"

export interface KnowledgeOverview {
  documents: number
  /** ISO date of the most recent upload. */
  lastUpdated: string | null
  /** Document types with the most documents, for example Manual 12. */
  types: Array<{ name: string; count: number }>
}

interface Row {
  uploaded_at: string
  metadata: { type_tag?: string } | null
}

export function summarizeKnowledge(rows: Row[]): KnowledgeOverview {
  const counts = new Map<string, number>()
  let lastUpdated: string | null = null
  for (const row of rows) {
    if (!lastUpdated || row.uploaded_at > lastUpdated) lastUpdated = row.uploaded_at
    const type = row.metadata?.type_tag?.trim()
    if (type) counts.set(type, (counts.get(type) ?? 0) + 1)
  }
  return {
    documents: rows.length,
    lastUpdated,
    types: Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
  }
}

/** What an assistant knows: document count, last update and main document types. */
export async function getKnowledgeOverview(
  supabase: AnySupabase,
  chatbotId: string
): Promise<KnowledgeOverview> {
  const { data, error } = await supabase
    .from("files")
    .select("uploaded_at, metadata")
    .eq("chatbot_id", chatbotId)
    .in("sync_status", ["ready", "external"])
  if (error) throw error
  return summarizeKnowledge((data ?? []) as Row[])
}

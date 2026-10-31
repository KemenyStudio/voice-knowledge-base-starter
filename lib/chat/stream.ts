import type { ChatCitation } from "@/types/knowledge"
import type { WebLookup } from "@/lib/web-search"

export interface StreamDone {
  id: string
  output_text: string
  citations: ChatCitation[]
  clarify?: {
    question: string
    options: string[]
    kind?: "entity_type"
  } | null
  entity_filter?: { applied: boolean; entity: string | null } | null
  /** Research mode: the searches that were run. */
  research?: { steps: Array<{ label: string; sources: number }> } | null
  /** Id of the user message stored for this turn, so it can be edited later. */
  user_message_id?: string
  /** Present only when the question asked for a newer official source. */
  web_sources?: WebLookup | null
}

export type StreamEvent =
  | { type: "status"; status: string }
  | { type: "delta"; text: string }
  | { type: "plan"; steps: Array<{ id: number; label: string }> }
  | {
      type: "step"
      id: number
      status: "searching" | "done"
      sources?: number
    }
  | ({ type: "done" } & StreamDone)
  | { type: "followups"; questions: string[] }
  | { type: "error"; message: string }

/** Reads newline-delimited JSON events from a fetch response body. */
export async function readEvents(
  response: Response,
  onEvent: (event: StreamEvent) => void
): Promise<void> {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffered = ""

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split("\n")
    buffered = lines.pop() ?? ""
    for (const line of lines) {
      if (line.trim()) onEvent(JSON.parse(line) as StreamEvent)
    }
  }
  if (buffered.trim()) onEvent(JSON.parse(buffered) as StreamEvent)
}

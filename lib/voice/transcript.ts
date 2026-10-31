export interface TranscriptCitation {
  number: number
  title: string
  outdated?: boolean
}

export interface TranscriptLine {
  id: string
  role: "user" | "assistant"
  text: string
  citations?: TranscriptCitation[]
}

export interface TranscriptState {
  lines: TranscriptLine[]
  /** Citations from the search that just finished, waiting for the spoken answer. */
  pendingCitations: TranscriptCitation[]
}

export const EMPTY_TRANSCRIPT: TranscriptState = {
  lines: [],
  pendingCitations: [],
}

export type TranscriptAction =
  | { type: "delta"; id: string; role: "user" | "assistant"; delta: string }
  | { type: "done"; id: string; role: "user" | "assistant"; text: string }
  | { type: "citations"; citations: TranscriptCitation[] }
  | { type: "reset" }

function withPending(
  line: TranscriptLine,
  pending: TranscriptCitation[]
): { line: TranscriptLine; pending: TranscriptCitation[] } {
  if (line.role !== "assistant" || pending.length === 0 || line.citations) {
    return { line, pending }
  }
  return { line: { ...line, citations: pending }, pending: [] }
}

/** Live transcript. Search citations stick to the next spoken assistant turn. */
export function reduceTranscript(
  state: TranscriptState,
  action: TranscriptAction
): TranscriptState {
  switch (action.type) {
    case "reset":
      return EMPTY_TRANSCRIPT
    case "citations":
      return { ...state, pendingCitations: action.citations }
    case "delta": {
      if (!action.id || !action.delta) return state
      const index = state.lines.findIndex((line) => line.id === action.id)
      if (index === -1) {
        const created = withPending(
          { id: action.id, role: action.role, text: action.delta },
          state.pendingCitations
        )
        return {
          lines: [...state.lines, created.line],
          pendingCitations: created.pending,
        }
      }
      const next = state.lines.slice()
      const updated = withPending(
        { ...next[index], text: next[index].text + action.delta },
        state.pendingCitations
      )
      next[index] = updated.line
      return { lines: next, pendingCitations: updated.pending }
    }
    case "done": {
      if (!action.id) return state
      const index = state.lines.findIndex((line) => line.id === action.id)
      if (index === -1) {
        if (!action.text) return state
        const created = withPending(
          { id: action.id, role: action.role, text: action.text },
          state.pendingCitations
        )
        return {
          lines: [...state.lines, created.line],
          pendingCitations: created.pending,
        }
      }
      const next = state.lines.slice()
      const updated = withPending(
        { ...next[index], text: action.text || next[index].text },
        state.pendingCitations
      )
      next[index] = updated.line
      return { lines: next, pendingCitations: updated.pending }
    }
    default: {
      const unreachable: never = action
      return unreachable
    }
  }
}

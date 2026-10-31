export interface ParsedReference {
  number: number
  /** Everything the model wrote after the number: title, pages, articles. */
  text: string
}

export interface SplitAnswer {
  /** The answer without its trailing "Referencias:" section. */
  body: string
  references: ParsedReference[]
}

/**
 * Drops leaked file-search markers (filecite, turn0file1, and the private-use
 * characters that wrap them) without touching [N] citations or the Fuentes list.
 */
export function stripFileCiteMarkers(text: string): string {
  const cleaned = text
    .replace(/[\uE000-\uF8FF]/g, "")
    .replace(/【[^〕\n]*(?:filecite|turn\d+file\d*)[^〕\n]*〕/gi, "")
    .replace(/filecite/gi, "")
    .replace(/turn\d+file\d*/gi, "")
  return cleaned
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,;:!?])/g, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

const HEADING =
  /^[ \t]*(?:#{1,6}[ \t]*)?[*_]*[ \t]*(?:referencias|fuentes|references)[ \t]*:?[ \t]*[*_]*[ \t]*:?[ \t]*(.*)$/i

const ENTRY = /^[ \t]*(?:[-*][ \t]+)?\**\[(\d+)\]\**[ \t]*[:.\-–]?[ \t]*(.*)$/

/**
 * Separates the "Referencias:" section from the answer so it can be shown as
 * a proper list of sources instead of a run-on paragraph.
 */
export function splitReferences(text: string): SplitAnswer {
  text = stripFileCiteMarkers(text)
  const lines = text.split("\n")

  let start = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    if (HEADING.test(lines[i])) {
      start = i
      break
    }
    // A reference section never starts after a long stretch of plain text.
    if (lines.length - i > 60) break
  }
  if (start === -1) return { body: text, references: [] }

  const references: ParsedReference[] = []
  const first = HEADING.exec(lines[start])?.[1]?.trim()
  const rest = [...(first ? [first] : []), ...lines.slice(start + 1)]

  for (const line of rest) {
    // Blank lines and leftover bold markers (formatReferences can split
    // "**Referencias:**" over two lines) carry no content.
    if (!line.replace(/[\s*_]/g, "")) continue
    const entry = ENTRY.exec(line)
    if (entry) {
      references.push({ number: Number(entry[1]), text: entry[2].trim() })
    } else if (references.length > 0) {
      const detail = line.replace(/^[ \t]*[-*•][ \t]+/, "").trim()
      const last = references[references.length - 1]
      last.text = `${last.text}\n${detail}`.trim()
    } else {
      // Heading followed by something that is not a reference list: keep the text.
      return { body: text, references: [] }
    }
  }
  if (references.length === 0) return { body: text, references: [] }

  return { body: lines.slice(0, start).join("\n").trimEnd(), references }
}

/** "Manual X, (páginas 5-12)" -> { title: "Manual X", pages: "5-12" } */
export function describeReference(text: string): {
  title: string
  pages: string | null
  details: string[]
} {
  const [firstLine, ...details] = text.split("\n")
  const pages = /\(?\s*p[áa]ginas?\s*([\d\s,\-–y]+)\)?/i.exec(firstLine)
  const title = firstLine
    .replace(/,?\s*\(?\s*p[áa]ginas?\s*[\d\s,\-–y]+\)?\.?$/i, "")
    .replace(/[,.\s]+$/, "")
    .trim()
  return {
    title,
    pages: pages ? pages[1].trim().replace(/\s*-\s*/g, "–") : null,
    details: details.map((d) => d.trim()).filter(Boolean),
  }
}

/** Turns [N] markers into links the chat can intercept (#cite-N). */
export function linkCitations(markdown: string): string {
  return markdown.replace(/\[(\d+)\](?!\()/g, "[$1](#cite-$1)")
}

export interface ExportSource {
  number: number
  title: string
  pages?: string | null
}

export interface ExportEntry {
  question?: string
  answer: string
  sources: ExportSource[]
}

export const EXPORT_DISCLAIMER =
  "Esto no es asesoría legal. Contrasta cada afirmación con el texto oficial citado."

/** Markdown of one or more question/answer pairs, with a sources list. */
export function toMarkdown(title: string, entries: ExportEntry[]): string {
  const parts = [`# ${title}`]
  for (const entry of entries) {
    if (entry.question) parts.push(`## ${entry.question}`)
    parts.push(entry.answer.trim())
    if (entry.sources.length > 0) {
      parts.push(
        "**Fuentes**\n\n" +
          entry.sources
            .map(
              (s) =>
                `${s.number}. ${s.title}${s.pages ? ` (páginas ${s.pages})` : ""}`
            )
            .join("\n")
      )
    }
  }
  parts.push(EXPORT_DISCLAIMER)
  return parts.join("\n\n") + "\n"
}

export interface TranscriptTurn {
  role: "user" | "assistant"
  content: string
  citations?: Array<{ number: number; title: string | null }>
}

/** One Markdown file for a whole conversation, questions in order. */
export function transcriptToMarkdown(title: string, messages: TranscriptTurn[]): string {
  const entries: ExportEntry[] = []
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]
    if (message.role !== "user") continue
    const next = messages[i + 1]
    const answer = next?.role === "assistant" ? next : undefined
    entries.push({
      question: message.content,
      answer: answer ? splitReferences(answer.content).body : "",
      sources: answer ? sourcesOf(answer) : [],
    })
  }
  if (entries.length === 0) {
    return toMarkdown(title, [
      { answer: "Esta conversación no tiene preguntas.", sources: [] },
    ])
  }
  return toMarkdown(title, entries)
}

function sourcesOf(answer: TranscriptTurn): ExportSource[] {
  const described = new Map<number, ReturnType<typeof describeReference>>()
  for (const reference of splitReferences(answer.content).references) {
    described.set(reference.number, describeReference(reference.text))
  }
  const numbers: number[] = []
  const seen: Record<number, true> = {}
  const add = (number: number) => {
    if (seen[number]) return
    seen[number] = true
    numbers.push(number)
  }
  for (const citation of answer.citations ?? []) add(citation.number)
  described.forEach((_value, number) => add(number))
  numbers.sort((a, b) => a - b)
  return numbers.map((number) => {
    const citation = answer.citations?.find((item) => item.number === number)
    const fromText = described.get(number)
    return {
      number,
      title: citation?.title || fromText?.title || `Fuente ${number}`,
      pages: fromText?.pages ?? null,
    }
  })
}

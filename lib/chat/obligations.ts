export interface ObligationRow {
  obligation: string
  deadline: string
  sanction: string
}

const HEADER = {
  obligation: /obligaci[oó]n|deber|requisito/i,
  deadline: /plazo|fecha|vencimiento|t[eé]rmino/i,
  sanction: /sanci[oó]n|multa|consecuencia/i,
} as const

type Column = keyof typeof HEADER

function cells(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim())
}

function isSeparator(line: string): boolean {
  const parts = cells(line)
  return parts.length > 1 && parts.every((part) => /^:?-{3,}:?$/.test(part))
}

function columnMap(header: string[]): Partial<Record<Column, number>> | null {
  const map: Partial<Record<Column, number>> = {}
  header.forEach((cell, index) => {
    ;(Object.keys(HEADER) as Column[]).forEach((column) => {
      if (map[column] === undefined && HEADER[column].test(cell)) {
        map[column] = index
      }
    })
  })
  if (
    map.obligation === undefined ||
    map.deadline === undefined ||
    map.sanction === undefined
  ) {
    return null
  }
  return map
}

function rowFrom(cellsInRow: string[], map: Record<Column, number>): ObligationRow | null {
  const obligation = (cellsInRow[map.obligation] ?? "").trim()
  const deadline = (cellsInRow[map.deadline] ?? "").trim()
  const sanction = (cellsInRow[map.sanction] ?? "").trim()
  if (!obligation && !deadline && !sanction) return null
  return {
    obligation: obligation.slice(0, 500),
    deadline: deadline.slice(0, 240),
    sanction: sanction.slice(0, 500),
  }
}

/** Reads a markdown table that already names the three columns. */
export function extractObligationsFromAnswer(markdown: string): ObligationRow[] {
  const lines = markdown.split(/\r?\n/)
  const rows: ObligationRow[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    if (!lines[i].includes("|") || !isSeparator(lines[i + 1])) continue
    const map = columnMap(cells(lines[i]))
    if (!map) continue
    const columns = map as Record<Column, number>
    for (let j = i + 2; j < lines.length; j++) {
      if (!lines[j].includes("|")) break
      const parsed = rowFrom(cells(lines[j]), columns)
      if (parsed) rows.push(parsed)
    }
  }
  if (rows.length > 0) return rows.slice(0, 40)

  const block =
    /(?:obligaci[oó]n|deber)\s*[:：]\s*(.+?)\s*(?:plazo|fecha|vencimiento)\s*[:：]\s*(.+?)\s*(?:sanci[oó]n|multa)\s*[:：]\s*(.+?)(?=(?:\n\s*(?:obligaci[oó]n|deber)\s*[:：])|$)/gis
  for (const match of Array.from(markdown.matchAll(block))) {
    const parsed = {
      obligation: match[1].replace(/\s+/g, " ").trim().slice(0, 500),
      deadline: match[2].replace(/\s+/g, " ").trim().slice(0, 240),
      sanction: match[3].replace(/\s+/g, " ").trim().slice(0, 500),
    }
    if (parsed.obligation || parsed.deadline || parsed.sanction) rows.push(parsed)
  }
  return rows.slice(0, 40)
}

export function parseObligationPayload(raw: string): ObligationRow[] {
  try {
    const parsed = JSON.parse(raw) as { rows?: unknown }
    if (!Array.isArray(parsed.rows)) return []
    const rows: ObligationRow[] = []
    for (const item of parsed.rows) {
      if (!item || typeof item !== "object") continue
      const record = item as Record<string, unknown>
      const obligation = typeof record.obligation === "string" ? record.obligation.trim() : ""
      const deadline = typeof record.deadline === "string" ? record.deadline.trim() : ""
      const sanction = typeof record.sanction === "string" ? record.sanction.trim() : ""
      if (!obligation && !deadline && !sanction) continue
      rows.push({
        obligation: obligation.slice(0, 500),
        deadline: deadline.slice(0, 240),
        sanction: sanction.slice(0, 500),
      })
    }
    return rows.slice(0, 40)
  } catch {
    return []
  }
}

function cell(value: string): string {
  return (value || "—").replace(/\|/g, "/").replace(/\s+/g, " ").trim()
}

export function obligationsToMarkdown(rows: ObligationRow[]): string {
  const lines = ["| Obligación | Plazo | Sanción |", "| --- | --- | --- |"]
  for (const row of rows) {
    lines.push(`| ${cell(row.obligation)} | ${cell(row.deadline)} | ${cell(row.sanction)} |`)
  }
  return lines.join("\n")
}

export function obligationsToTsv(rows: ObligationRow[]): string {
  const lines = ["Obligación\tPlazo\tSanción"]
  for (const row of rows) {
    lines.push(
      [row.obligation, row.deadline, row.sanction]
        .map((value) => (value || "—").replace(/[\t\n\r]+/g, " ").trim())
        .join("\t")
    )
  }
  return lines.join("\n")
}

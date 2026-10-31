function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/\.[a-z0-9]{1,5}$/i, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function tokens(value: string): string[] {
  return fold(value)
    .split(" ")
    .filter((word) => word.length > 3)
}

/**
 * True when a proposal title is already the name of a library document.
 * An exact name matches at any length. A partial overlap still requires a
 * long title, so a generic label does not hide a different document.
 */
export function isAlreadyInLibrary(title: string, fileNames: string[]): boolean {
  const folded = fold(title)
  if (!folded) return false
  for (const name of fileNames) {
    if (fold(name) === folded) return true
  }
  if (folded.length < 18) return false
  const titleTokens = tokens(title)
  for (const name of fileNames) {
    const file = fold(name)
    if (file.length < 12) continue
    if (file.includes(folded) || folded.includes(file)) return true
    const fileTokens = new Set(tokens(name))
    if (titleTokens.length < 4 || fileTokens.size < 4) continue
    let shared = 0
    for (const token of titleTokens) {
      if (fileTokens.has(token)) shared += 1
    }
    const overlap = shared / Math.min(titleTokens.length, fileTokens.size)
    if (shared >= 4 && overlap >= 0.75) return true
  }
  return false
}

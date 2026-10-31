import { foldText } from "@/lib/audience"

export interface LibraryFileName {
  id: string
  file_name: string
  outdated?: boolean
}

/**
 * Picks one library document from a spoken title. Exact folded titles win.
 * A single partial match is accepted. Several partial matches are ambiguous.
 */
export function matchLibraryFile(
  files: LibraryFileName[],
  query: string
): { match: LibraryFileName | null; ambiguous: string[] } {
  const wanted = foldText(query)
  if (!wanted) return { match: null, ambiguous: [] }

  const exact = files.filter((file) => foldText(file.file_name) === wanted)
  if (exact.length === 1) return { match: exact[0], ambiguous: [] }

  const partial = files.filter((file) => {
    const name = foldText(file.file_name)
    return name.includes(wanted) || wanted.includes(name)
  })
  if (partial.length === 1) return { match: partial[0], ambiguous: [] }
  if (partial.length > 1) {
    return { match: null, ambiguous: partial.map((file) => file.file_name).slice(0, 8) }
  }
  return { match: null, ambiguous: [] }
}

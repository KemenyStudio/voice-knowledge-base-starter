import type { SuggestedQuestionGroup } from "@/types/chatbot"

/**
 * Editable text form of the example questions:
 *   ## Category
 *   Question one
 *   Question two
 * Questions before the first heading go to the category "General".
 */
export function suggestedToText(groups: SuggestedQuestionGroup[]): string {
  return groups
    .map((g) => [`## ${g.category}`, ...g.prompts].join("\n"))
    .join("\n\n")
}

export function textToSuggested(text: string): SuggestedQuestionGroup[] {
  const groups: SuggestedQuestionGroup[] = []
  let current: SuggestedQuestionGroup | null = null

  for (const raw of text.split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const heading = /^#{1,3}\s*(.+)$/.exec(line)
    if (heading) {
      current = { category: heading[1].trim(), prompts: [] }
      groups.push(current)
    } else {
      if (!current) {
        current = { category: "General", prompts: [] }
        groups.push(current)
      }
      current.prompts.push(line)
    }
  }
  return groups.filter((g) => g.prompts.length > 0)
}

/** How many example questions the empty chat shows. */
export const EMPTY_CHAT_PROMPT_LIMIT = 6

/** How many category labels the empty chat shows. */
export const EMPTY_CHAT_GROUP_LIMIT = 3

/**
 * The empty chat keeps at most three labels and six prompts.
 * Prompts are taken in turns across those labels, in their original order,
 * so one long category cannot fill the list.
 */
export function emptyChatGroups(
  groups: SuggestedQuestionGroup[]
): SuggestedQuestionGroup[] {
  const source = groups
    .map((group) => ({
      category: group.category.trim(),
      prompts: group.prompts.map((prompt) => prompt.trim()).filter(Boolean),
    }))
    .filter((group) => group.category && group.prompts.length > 0)
    .slice(0, EMPTY_CHAT_GROUP_LIMIT)

  const picked: SuggestedQuestionGroup[] = source.map((group) => ({
    category: group.category,
    prompts: [],
  }))
  const cursor = source.map(() => 0)
  let remaining = EMPTY_CHAT_PROMPT_LIMIT

  while (remaining > 0) {
    let took = false
    for (let i = 0; i < source.length; i++) {
      const at = cursor[i]
      if (at >= source[i].prompts.length) continue
      picked[i].prompts.push(source[i].prompts[at])
      cursor[i] = at + 1
      remaining -= 1
      took = true
      if (remaining === 0) break
    }
    if (!took) break
  }

  return picked.filter((group) => group.prompts.length > 0)
}

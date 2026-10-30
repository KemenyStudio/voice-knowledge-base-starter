export interface SuggestedQuestionGroup {
  category: string
  prompts: string[]
}

export interface Chatbot {
  id: string
  name: string
  description: string
  team_id: string
  welcome_message?: string | null
  suggested_questions?: SuggestedQuestionGroup[]
  audience_options?: string[]
  audience_filter?: boolean
  prompt_notes?: string[]
  research_enabled?: boolean
  enabled_tools?: string[]
}

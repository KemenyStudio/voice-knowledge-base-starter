export interface OnboardingStep {
  id: "assistant" | "documents" | "teammate" | "question"
  done: boolean
}

"use client"

import { CornerDownRight } from "lucide-react"

import { Button } from "@/components/ui/button"

export function FollowUps({
  questions,
  onSelect,
  disabled,
}: {
  questions: string[]
  onSelect: (question: string) => void
  disabled?: boolean
}) {
  if (questions.length === 0) return null
  return (
    <div className="mt-8 border-t border-border/80 pt-5">
      <p className="mb-2 text-xs font-medium text-muted-foreground">
        Preguntas sugeridas
      </p>
      <div className="flex flex-col items-start gap-1">
        {questions.map((question) => (
          <Button
            key={question}
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => onSelect(question)}
            className="h-auto min-h-11 max-w-full justify-start whitespace-normal break-words rounded-lg px-2 py-2 text-left text-[15px] font-normal leading-6 text-muted-foreground hover:text-foreground"
          >
            <CornerDownRight className="mr-2 h-3.5 w-3.5 flex-shrink-0" />
            {question}
          </Button>
        ))}
      </div>
    </div>
  )
}

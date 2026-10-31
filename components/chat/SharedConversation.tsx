"use client"

import { AnswerMarkdown } from "@/components/chat/AnswerMarkdown"
import { Sources, buildSources } from "@/components/chat/Sources"
import { splitReferences } from "@/lib/chat/references"
import type { ChatCitation } from "@/types/knowledge"

export interface SharedMessage {
  role: "user" | "assistant"
  content: string
  citations: Array<{
    number: number
    title: string
    text: string
    url: string | null
  }>
}

export default function SharedConversation({
  messages,
}: {
  messages: SharedMessage[]
}) {
  return (
    <div className="space-y-6">
      {messages.map((message, index) => {
        if (message.role === "user") {
          return (
            <div
              key={index}
              className="ml-auto max-w-[40rem] rounded-2xl bg-muted px-4 py-2.5 text-foreground"
            >
              <p className="whitespace-pre-wrap">{message.content}</p>
            </div>
          )
        }
        const { body, references } = splitReferences(message.content)
        const citations = message.citations.map(
          (c): ChatCitation => ({
            number: c.number,
            file_id: "",
            filename: "",
            title: c.title,
            text: c.text,
            score: 0,
            attributes: {},
            file_url: c.url,
          })
        )
        const cited = new Set(
          Array.from(body.matchAll(/\[(\d+)\]/g)).map((m) => Number(m[1]))
        )
        return (
          <div
            key={index}
            className="max-w-full text-foreground"
          >
            <AnswerMarkdown markdown={body} />
            <Sources sources={buildSources(references, citations, cited)} />
          </div>
        )
      })}
    </div>
  )
}

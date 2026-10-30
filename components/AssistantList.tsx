"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { createClientComponentClient } from "@supabase/auth-helpers-nextjs"

import { Button } from "@/components/ui/button"

interface AssistantSummary {
  id: string
  name: string
  description: string | null
}

/** Every assistant the signed-in user can chat with, across their teams. */
export default function AssistantList() {
  const supabase = createClientComponentClient()
  const [assistants, setAssistants] = useState<AssistantSummary[] | null>(null)

  useEffect(() => {
    supabase
      .from("chatbots")
      .select("id, name, description")
      .order("name")
      .then(({ data, error }) => {
        if (error) console.error("Error fetching assistants:", error)
        setAssistants((data as AssistantSummary[] | null) ?? [])
      })
  }, [supabase])

  if (assistants === null) return <p className="text-sm">Cargando...</p>
  if (assistants.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Todavía no hay asistentes. Abre un equipo para crear el primero.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      {assistants.map((assistant) => (
        <Button
          key={assistant.id}
          variant="outline"
          asChild
          className="h-auto w-full justify-start py-2 text-left"
        >
          <Link href={`/chatbot/${assistant.id}`}>
            <span className="flex flex-col">
              <span className="font-medium">{assistant.name}</span>
              {assistant.description && (
                <span className="line-clamp-2 whitespace-normal text-xs font-normal text-muted-foreground">
                  {assistant.description}
                </span>
              )}
            </span>
          </Link>
        </Button>
      ))}
    </div>
  )
}

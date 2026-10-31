"use client"

import { useState } from "react"
import { FolderPlus, Pencil, Pin } from "lucide-react"

import type { ChatMessage } from "@/components/chat/types"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export function ThreadOutline({ messages }: { messages: ChatMessage[] }) {
  const pinned = messages
    .map((message, index) => ({ message, index }))
    .filter((item) => item.message.role === "user" && item.message.pinned)
  const folders: string[] = []
  for (const message of messages) {
    if (message.role === "user" && message.folder && !folders.includes(message.folder)) {
      folders.push(message.folder)
    }
  }
  if (pinned.length === 0 && folders.length === 0) return null

  return (
    <nav
      aria-label="Organización del hilo"
      className="mb-6 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm dark:border-white/10 dark:bg-white/5"
    >
      {pinned.length > 0 && (
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Fijadas
          </p>
          <ul className="space-y-1">
            {pinned.map((item) => (
              <li key={item.message.id ?? item.index}>
                <a
                  href={`#chat-turn-${item.index}`}
                  className="line-clamp-2 text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100"
                >
                  {item.message.content}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
      {folders.length > 0 && (
        <div className={pinned.length > 0 ? "mt-3" : ""}>
          <p className="mb-1 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Carpetas
          </p>
          <ul className="space-y-1">
            {folders.map((folder) => (
              <li key={folder}>
                <a href={`#folder-${folderSlug(folder)}`} className="text-zinc-700 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
                  {folder}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  )
}

export function folderSlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

export function QuestionActions({
  message,
  folders,
  disabled,
  onEdit,
  onPlace,
}: {
  message: ChatMessage
  folders: string[]
  disabled: boolean
  onEdit: (messageId: string, text: string) => void
  onPlace: (
    messageId: string,
    patch: { pinned?: boolean; setFolder?: boolean; folder?: string | null }
  ) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(message.content)
  const [naming, setNaming] = useState(false)
  const [folderName, setFolderName] = useState("")
  const messageId = message.id

  if (!messageId) return null

  if (editing) {
    return (
      <div className="mt-2 w-full max-w-[40rem] space-y-2">
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          className="min-h-[80px] bg-zinc-100 dark:bg-[#2a2a2a]"
          aria-label="Editar pregunta"
        />
        <p className="text-xs text-muted-foreground">
          Se quitan esta pregunta y lo que sigue en el hilo. Un enlace ya compartido no cambia.
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            disabled={disabled || !draft.trim()}
            onClick={() => onEdit(messageId, draft.trim())}
          >
            Preguntar de nuevo
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-zinc-500"
        disabled={disabled}
        data-testid="edit-question"
        onClick={() => {
          setDraft(message.content)
          setEditing(true)
        }}
      >
        <Pencil className="mr-1 h-3.5 w-3.5" />
        Editar
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-zinc-500"
        disabled={disabled}
        aria-pressed={Boolean(message.pinned)}
        onClick={() => onPlace(messageId, { pinned: !message.pinned })}
      >
        <Pin className="mr-1 h-3.5 w-3.5" />
        {message.pinned ? "Quitar" : "Fijar"}
      </Button>
      <label className="sr-only" htmlFor={`folder-${messageId}`}>
        Carpeta
      </label>
      <select
        id={`folder-${messageId}`}
        className="h-8 max-w-[10rem] rounded-md border border-zinc-200 bg-transparent px-2 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400"
        value={message.folder ?? ""}
        disabled={disabled}
        aria-label="Carpeta"
        onChange={(event) => {
          const value = event.target.value
          if (value === "__new") {
            setNaming(true)
            return
          }
          onPlace(messageId, { setFolder: true, folder: value || null })
        }}
      >
        <option value="">Sin carpeta</option>
        {folders.map((folder) => (
          <option key={folder} value={folder}>
            {folder}
          </option>
        ))}
        <option value="__new">Nueva carpeta…</option>
      </select>
      {naming && (
        <form
          className="flex items-center gap-1"
          onSubmit={(event) => {
            event.preventDefault()
            const name = folderName.trim()
            if (!name) return
            onPlace(messageId, { setFolder: true, folder: name })
            setNaming(false)
            setFolderName("")
          }}
        >
          <Input
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            placeholder="Nombre"
            maxLength={40}
            className="h-8 w-32"
            aria-label="Nombre de la carpeta"
          />
          <Button type="submit" size="sm" variant="ghost" className="h-8 px-2">
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
        </form>
      )}
    </div>
  )
}

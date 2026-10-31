"use client"

import { useEffect, useMemo, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import type { DocumentAction } from "@/lib/document-actions"

interface LibraryFile {
  id: string
  file_name: string
  sync_status?: string
}

interface DocumentActionPickerProps {
  chatbotId: string
  action: Exclude<DocumentAction, "summarize"> | null
  source: { id: string; title: string } | null
  onCancel: () => void
  onPick: (other: { id: string; title: string }) => void
}

const COPY = {
  compare: {
    title: "Comparar con otro documento",
    description: (title: string) =>
      `Elige el documento que quieres comparar con «${title}».`,
  },
  changes: {
    title: "Ver qué cambió",
    description: (title: string) =>
      `Elige la versión anterior o relacionada con «${title}».`,
  },
} as const

export function DocumentActionPicker({
  chatbotId,
  action,
  source,
  onCancel,
  onPick,
}: DocumentActionPickerProps) {
  const [files, setFiles] = useState<LibraryFile[] | null>(null)
  const [search, setSearch] = useState("")
  const open = Boolean(action && source)

  useEffect(() => {
    if (!open) return
    setSearch("")
    let cancelled = false
    fetch(`/api/files?chatbotId=${encodeURIComponent(chatbotId)}`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!cancelled) setFiles(Array.isArray(data) ? data : [])
      })
      .catch(() => !cancelled && setFiles([]))
    return () => {
      cancelled = true
    }
  }, [open, chatbotId])

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase()
    return (files ?? [])
      .filter((f) => f.id !== source?.id && f.sync_status !== "failed")
      .filter((f) => !term || f.file_name.toLowerCase().includes(term))
      .sort((a, b) => a.file_name.localeCompare(b.file_name))
      .slice(0, 60)
  }, [files, search, source?.id])

  if (!action || !source) return null
  const copy = COPY[action]

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>{copy.description(source.title)}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          placeholder="Buscar un documento…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="max-h-72 space-y-1 overflow-y-auto" data-testid="document-picker-list">
          {files === null && <p className="p-2 text-sm text-gray-500">Cargando…</p>}
          {files !== null && candidates.length === 0 && (
            <p className="p-2 text-sm text-gray-500">No hay documentos que coincidan.</p>
          )}
          {candidates.map((file) => (
            <Button
              key={file.id}
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start whitespace-normal px-2 py-1.5 text-left font-normal"
              onClick={() => onPick({ id: file.id, title: file.file_name })}
            >
              {file.file_name}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

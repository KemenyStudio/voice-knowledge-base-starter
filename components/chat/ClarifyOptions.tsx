"use client"

import { Filter, HelpCircle } from "lucide-react"

import { Button } from "@/components/ui/button"

/** Option buttons for a clarifying question; picking one answers it. */
export function ClarifyOptions({
  options,
  onSelect,
}: {
  options: string[]
  onSelect: (option: string) => void
}) {
  if (options.length === 0) return null
  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-2"
      data-testid="clarify-options"
    >
      <HelpCircle className="h-4 w-4 text-gray-400" aria-hidden />
      {options.map((option) => (
        <Button
          key={option}
          variant="outline"
          size="sm"
          onClick={() => onSelect(option)}
          className="h-auto min-h-8 whitespace-normal py-1.5 text-left font-normal"
        >
          {option}
        </Button>
      ))}
    </div>
  )
}

/** Says the answer only searched documents for one entity type, and offers to search all. */
export function EntityFilterNote({
  entity,
  onSearchAll,
  disabled,
}: {
  entity: string
  onSearchAll: () => void
  disabled?: boolean
}) {
  return (
    <div
      className="mb-6 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground"
      data-testid="entity-filter-note"
    >
      <Filter className="h-3.5 w-3.5" aria-hidden />
      <span>Se buscó en los documentos aplicables a {entity}.</span>
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-xs"
        disabled={disabled}
        onClick={onSearchAll}
      >
        Buscar en todos los documentos
      </Button>
    </div>
  )
}

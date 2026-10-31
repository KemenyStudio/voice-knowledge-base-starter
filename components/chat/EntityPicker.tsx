"use client"

import { Building2, Check, ChevronDown } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

/** Header chip: the entity type the assistant remembers. */
export function EntityChip({
  entity,
  options,
  onChange,
}: {
  entity: string | null
  options: string[]
  onChange: (entity: string | null) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-10 max-w-full gap-1 rounded-full px-3 text-xs font-normal sm:h-8"
          data-testid="entity-chip"
          aria-label="Perfil"
        >
          <Building2 className="h-3.5 w-3.5 shrink-0" />
          <span className="max-w-[9rem] truncate sm:max-w-[14rem]">{entity ?? "Perfil"}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[min(20rem,calc(100vw-1.5rem))]">
        {options.map((option) => (
          <DropdownMenuItem key={option} className="whitespace-normal" onSelect={() => onChange(option)}>
            <span className="flex-1">{option}</span>
            {option === entity && <Check className="ml-2 h-4 w-4" />}
          </DropdownMenuItem>
        ))}
        {entity && (
          <DropdownMenuItem onSelect={() => onChange(null)}>
            Olvidar mi perfil
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Shown once in the empty state: asks who the user works for. */
export function EntityPrompt({
  options,
  onPick,
  onDismiss,
}: {
  options: string[]
  onPick: (entity: string) => void
  onDismiss: () => void
}) {
  return (
    <div className="space-y-2" data-testid="entity-prompt">
      <p className="px-2 text-sm font-medium text-muted-foreground">
        ¿Con qué perfil trabajas? Lo recordaré para adaptar las respuestas.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {options.map((option) => (
          <Button
            key={option}
            variant="outline"
            size="sm"
            className="h-auto min-h-10 max-w-full whitespace-normal break-words text-left"
            onClick={() => onPick(option)}
          >
            {option}
          </Button>
        ))}
        <Button variant="ghost" size="sm" className="h-10" onClick={onDismiss}>
          Ahora no
        </Button>
      </div>
    </div>
  )
}

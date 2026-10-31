"use client"

import { Check } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

/** Perfil opened from the call: entity type and mail notices. No password change. */
export function ProfileView({
  entity,
  options,
  onEntityChange,
  emailAlerts,
  onEmailAlertsChange,
}: {
  entity: string | null
  options: string[]
  onEntityChange: (entity: string | null) => void
  emailAlerts: boolean
  onEmailAlertsChange: (value: boolean) => void
}) {
  return (
    <div
      data-testid="profile-view"
      className="h-full overflow-y-auto bg-[#1e1e1e] px-4 py-6 text-zinc-100 sm:px-8"
    >
      <h1 className="text-lg font-medium">Perfil</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Tipo de entidad que este asistente recuerda, y avisos por correo.
      </p>
      <div className="mt-6 flex max-w-xl flex-wrap gap-2">
        {options.map((option) => (
          <Button
            key={option}
            type="button"
            variant={option === entity ? "default" : "outline"}
            className="h-auto min-h-10 whitespace-normal"
            onClick={() => onEntityChange(option)}
          >
            {option === entity && <Check className="mr-2 h-4 w-4" />}
            {option}
          </Button>
        ))}
        {entity && (
          <Button type="button" variant="ghost" className="h-10" onClick={() => onEntityChange(null)}>
            Olvidar mi perfil
          </Button>
        )}
        {options.length === 0 && (
          <p className="text-sm text-zinc-400">Este asistente no guarda un tipo de entidad.</p>
        )}
      </div>
      <label className="mt-8 flex max-w-xl cursor-pointer items-start gap-3">
        <span className="min-w-0 flex-1 text-sm leading-5">
          Avisarme por correo cuando cambie un documento que consulté (opcional)
        </span>
        <Switch
          checked={emailAlerts}
          onCheckedChange={onEmailAlertsChange}
          aria-label="Avisos por correo"
        />
      </label>
    </div>
  )
}

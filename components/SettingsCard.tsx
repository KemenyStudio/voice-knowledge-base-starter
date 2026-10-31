"use client"

import { useEffect, useState, type ComponentType } from "react"
import { ChevronUp, LogOut, Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import {
  type VoiceLength,
  type VoiceNavigation,
} from "@/lib/voice/call-settings"
import { HANGUP_PHRASES_DISPLAY } from "@/lib/voice/hangup"
import { cn } from "@/lib/utils"

type ThemeChoice = "light" | "dark"

/** Browser-only. "1" means the person hid Ajustes; the settings stay in the card. */
const HIDDEN_KEY = "settings-card-hidden"

function readHidden(): boolean {
  if (typeof window === "undefined") return false
  try {
    return window.localStorage.getItem(HIDDEN_KEY) === "1"
  } catch {
    return false
  }
}

function writeHidden(hidden: boolean) {
  try {
    window.localStorage.setItem(HIDDEN_KEY, hidden ? "1" : "0")
  } catch {
    // Private mode can block storage. The choice still applies for this visit.
  }
}

/** Preferences that are not navigation: theme, the call, document-change mail, and sign-out. */
export function SettingsCard({
  emailAlerts,
  onEmailAlertsChange,
  voiceLength,
  onVoiceLengthChange,
  voiceNavigation,
  onVoiceNavigationChange,
  onLogout,
}: {
  emailAlerts?: boolean
  onEmailAlertsChange?: (value: boolean) => void
  voiceLength?: VoiceLength
  onVoiceLengthChange?: (value: VoiceLength) => void
  voiceNavigation?: VoiceNavigation
  onVoiceNavigationChange?: (value: VoiceNavigation) => void
  onLogout: () => void
}) {
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    setMounted(true)
    setHidden(readHidden())
  }, [])

  const active: ThemeChoice = mounted && theme === "light" ? "light" : "dark"

  function toggleHidden(next: boolean) {
    setHidden(next)
    writeHidden(next)
  }

  return (
    <section
      data-testid="settings-card"
      data-hidden={hidden ? "true" : "false"}
      aria-label="Ajustes"
      className="rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 dark:border-white/10 dark:bg-white/[0.04]"
    >
      <div className={cn("flex items-center justify-between gap-2", !hidden && "mb-2")}>
        <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
          Ajustes
        </p>
        <button
          type="button"
          data-testid="settings-card-toggle"
          aria-expanded={!hidden}
          aria-controls="settings-card-body"
          aria-label={hidden ? "Mostrar ajustes" : "Ocultar ajustes"}
          onClick={() => toggleHidden(!hidden)}
          className="inline-flex h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium text-zinc-700 hover:bg-zinc-200/80 hover:text-zinc-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400 dark:text-zinc-200 dark:hover:bg-white/5 dark:hover:text-zinc-50 md:h-7"
        >
          {hidden ? "Mostrar" : "Ocultar"}
          {hidden && <ChevronUp className="h-3.5 w-3.5" aria-hidden />}
        </button>
      </div>
      {!hidden && (
      <div id="settings-card-body">
      <div className="mb-3">
        <p className="mb-1.5 text-xs text-zinc-700 dark:text-zinc-300" id="theme-label">
          Tema
        </p>
        <div
          role="group"
          aria-labelledby="theme-label"
          className="grid grid-cols-2 gap-1 rounded-md bg-zinc-200/80 p-0.5 dark:bg-black/30"
        >
          <ThemeOption
            label="Claro"
            icon={Sun}
            pressed={active === "light"}
            onClick={() => setTheme("light")}
          />
          <ThemeOption
            label="Oscuro"
            icon={Moon}
            pressed={active === "dark"}
            onClick={() => setTheme("dark")}
          />
        </div>
      </div>
      {onVoiceLengthChange && onVoiceNavigationChange && (
        <div className="mb-3">
          <p className="mb-1.5 text-xs text-zinc-700 dark:text-zinc-300" id="call-label">
            Llamada
          </p>
          <p className="mb-1 text-[11px] text-zinc-500" id="call-length-label">
            Extensión
          </p>
          <div
            role="group"
            aria-labelledby="call-length-label"
            className="mb-2 grid grid-cols-3 gap-1 rounded-md bg-zinc-200/80 p-0.5 dark:bg-black/30"
          >
            <Choice
              label="Breve"
              pressed={(voiceLength ?? "normal") === "breve"}
              onClick={() => onVoiceLengthChange("breve")}
              testId="voice-length-breve"
            />
            <Choice
              label="Normal"
              pressed={(voiceLength ?? "normal") === "normal"}
              onClick={() => onVoiceLengthChange("normal")}
              testId="voice-length-normal"
            />
            <Choice
              label="Detallada"
              pressed={(voiceLength ?? "normal") === "detallada"}
              onClick={() => onVoiceLengthChange("detallada")}
              testId="voice-length-detallada"
            />
          </div>
          <p className="mb-1 text-[11px] text-zinc-500" id="call-nav-label">
            Navegación
          </p>
          <div
            role="group"
            aria-labelledby="call-nav-label"
            className="mb-2 grid grid-cols-2 gap-1 rounded-md bg-zinc-200/80 p-0.5 dark:bg-black/30"
          >
            <Choice
              label="Pantallas"
              pressed={(voiceNavigation ?? "app") === "app"}
              onClick={() => onVoiceNavigationChange("app")}
              testId="voice-navigation-app"
            />
            <Choice
              label="Biblioteca"
              pressed={(voiceNavigation ?? "app") === "library"}
              onClick={() => onVoiceNavigationChange("library")}
              testId="voice-navigation-library"
            />
          </div>
          <p className="text-[11px] leading-4 text-zinc-500" data-testid="voice-hangup-phrases">
            Para colgar, di: {HANGUP_PHRASES_DISPLAY.join(", ")}. Siempre activo.
          </p>
        </div>
      )}
      {onEmailAlertsChange && (
        <label className="mb-2 flex cursor-pointer items-start gap-2">
          <span className="min-w-0 flex-1 text-xs leading-5 text-zinc-700 dark:text-zinc-300">
            Avisarme por correo cuando cambie un documento que consulté (opcional)
          </span>
          <Switch
            checked={Boolean(emailAlerts)}
            onCheckedChange={onEmailAlertsChange}
            aria-label="Avisos por correo"
            data-testid="email-alerts-switch"
            className="mt-0.5 shrink-0 data-[state=unchecked]:bg-zinc-300 dark:data-[state=unchecked]:bg-zinc-600 [&>span]:bg-white"
          />
        </label>
      )}
      <Button
        type="button"
        variant="ghost"
        className="h-11 w-full justify-start rounded-md px-2 text-sm font-normal text-zinc-700 hover:bg-zinc-200/80 hover:text-zinc-900 dark:text-zinc-300 dark:hover:bg-white/5 dark:hover:text-zinc-100 md:h-8"
        onClick={onLogout}
      >
        <LogOut className="mr-2 h-4 w-4 text-zinc-500" />
        Cerrar sesión
      </Button>
      </div>
      )}
    </section>
  )
}

function ThemeOption({
  label,
  icon: Icon,
  pressed,
  onClick,
}: {
  label: string
  icon: ComponentType<{ className?: string }>
  pressed: boolean
  onClick: () => void
}) {
  return (
    <Choice label={label} pressed={pressed} onClick={onClick} icon={Icon} />
  )
}

function Choice({
  label,
  pressed,
  onClick,
  icon: Icon,
  testId,
}: {
  label: string
  pressed: boolean
  onClick: () => void
  icon?: ComponentType<{ className?: string }>
  testId?: string
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-testid={testId}
      className={cn(
        "flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-[5px] px-1 text-[11px] font-medium sm:text-xs",
        pressed
          ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-700 dark:text-zinc-50"
          : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      )}
    >
      {Icon && <Icon className="h-3.5 w-3.5" />}
      {label}
    </button>
  )
}

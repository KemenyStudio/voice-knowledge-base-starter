"use client"

import { useCallback, useState } from "react"

import { BrandMark } from "@/components/brand-mark"
import { VoiceCall } from "@/components/chat/VoiceCall"

type CallPhase = "idle" | "connecting" | "live"

const STATUS: Record<CallPhase, string> = {
  idle: "Disponible",
  connecting: "Conectando…",
  live: "En llamada",
}

/** Compact identity for this assistant: name and call status. */
export function PresenceCard({ name }: { name: string }) {
  const [phase, setPhase] = useState<CallPhase>("idle")

  const onPhaseChange = useCallback((next: CallPhase) => {
    setPhase(next)
  }, [])

  return (
    <section
      data-testid="presence-card"
      className="mb-2 rounded-xl border border-zinc-200 bg-zinc-50 p-2.5 dark:border-white/10 dark:bg-white/[0.04]"
    >
      <div className="flex items-center gap-2">
        <BrandMark className="h-8 w-8 shrink-0 rounded-lg" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{name}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400">
            <span
              className={
                phase === "live"
                  ? "h-1.5 w-1.5 rounded-full bg-emerald-400"
                  : phase === "connecting"
                    ? "h-1.5 w-1.5 rounded-full bg-amber-300"
                    : "h-1.5 w-1.5 rounded-full bg-zinc-500"
              }
              aria-hidden
            />
            {STATUS[phase]}
          </p>
        </div>
      </div>
      <VoiceCall
        onPhaseChange={onPhaseChange}
        buttonClassName="mt-2 h-11 w-full justify-center sm:h-8"
      />
    </section>
  )
}

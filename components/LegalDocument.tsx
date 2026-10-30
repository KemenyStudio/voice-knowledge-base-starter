import type { ReactNode } from "react"
import Link from "next/link"

import { appName } from "@/app/config/assistant-defaults"
import { LegalLinks } from "@/components/LegalLinks"

export function LegalDocument({
  title,
  children,
}: {
  title: string
  children: ReactNode
}) {
  return (
    <div className="min-h-[100dvh] bg-gradient-to-b from-background to-secondary px-[max(1rem,env(safe-area-inset-left))] py-10 pb-[max(2rem,env(safe-area-inset-bottom))]">
      <article className="mx-auto w-full max-w-2xl space-y-4 text-sm leading-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{appName}</p>
        <h1 className="text-3xl font-bold">{title}</h1>
        {children}
        <LegalLinks className="pt-4" />
        <p>
          <Link href="/login" className="text-primary hover:underline">
            Volver a iniciar sesión
          </Link>
        </p>
      </article>
    </div>
  )
}

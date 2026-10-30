import Link from "next/link"

import { LegalLinks } from "@/components/LegalLinks"

export default function Register() {
  return (
    <div className="auth-screen bg-gradient-to-b from-background to-secondary">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="mb-2 text-3xl font-bold">Registro por invitación</h1>
        <p className="text-sm leading-6 text-muted-foreground">
          No hay registro abierto. Pide a un administrador de tu equipo que te
          envíe una invitación y abre el enlace que recibas.
        </p>
        <Link
          href="/login"
          className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Ya tengo cuenta
        </Link>
        <LegalLinks />
      </div>
    </div>
  )
}

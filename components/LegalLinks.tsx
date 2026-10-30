import Link from "next/link"

export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <p className={`text-center text-sm text-muted-foreground ${className}`}>
      <Link href="/terminos" className="underline-offset-2 hover:underline">
        Términos
      </Link>
      <span aria-hidden="true"> · </span>
      <Link href="/privacidad" className="underline-offset-2 hover:underline">
        Privacidad
      </Link>
    </p>
  )
}

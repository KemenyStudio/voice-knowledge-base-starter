type BrandMarkProps = {
  className?: string
  alt?: string
}

/** Neutral mark for the public boilerplate. */
export function BrandMark({ className, alt = "Document Search" }: BrandMarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      role="img"
      aria-label={alt}
      className={className}
    >
      <rect width="64" height="64" rx="14" fill="currentColor" opacity="0.12" />
      <path
        d="M18 16h20a8 8 0 0 1 8 8v24a4 4 0 0 1-4 4H22a4 4 0 0 1-4-4V16z"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path d="M26 16v-2a6 6 0 0 1 6-6h0" fill="none" stroke="currentColor" strokeWidth="3" />
      <path d="M24 32h16M24 40h12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

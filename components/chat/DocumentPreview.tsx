"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Loader2 } from "lucide-react"

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

/** Same-origin inline preview for library files; other URLs stay inside the overlay. */
export function previewSrc(url: string): string {
  if (url.startsWith("/api/files/") && url.includes("/download")) {
    return url.includes("?") ? `${url}&inline=1` : `${url}?inline=1`
  }
  return url
}

export function DocumentPreviewDialog({
  title,
  url,
  onClose,
  sandboxed = false,
  footer,
}: {
  title: string
  url: string | null
  onClose: () => void
  /** Blocks scripts when the preview is HTML from outside the library. */
  sandboxed?: boolean
  footer?: ReactNode
}) {
  const [loaded, setLoaded] = useState(false)
  const src = url ? previewSrc(url) : null

  useEffect(() => {
    setLoaded(false)
  }, [src])

  return (
    <Dialog
      open={src !== null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        data-testid="document-preview"
        className="flex h-[min(calc(100dvh-1.5rem),920px)] max-h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom)-1rem)] w-[min(1040px,calc(100vw-1rem))] max-w-none flex-col gap-0 overflow-hidden p-0"
      >
        <DialogHeader className="shrink-0 space-y-1 border-b px-5 py-4 pr-12 text-left">
          <DialogTitle className="truncate text-base">{title}</DialogTitle>
          <DialogDescription>Vista previa del documento</DialogDescription>
        </DialogHeader>
        <div className="relative min-h-0 flex-1 bg-muted">
          {!loaded && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Cargando documento…
            </div>
          )}
          {src && (
            <iframe
              key={src}
              title={title}
              src={src}
              sandbox={sandboxed ? "" : undefined}
              className="h-full w-full border-0 bg-background"
              onLoad={() => setLoaded(true)}
            />
          )}
        </div>
        {footer && (
          <div className="flex shrink-0 justify-end border-t px-5 py-3">{footer}</div>
        )}
      </DialogContent>
    </Dialog>
  )
}

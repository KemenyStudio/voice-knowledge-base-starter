export function downloadTextFile(
  filename: string,
  text: string,
  mime = "text/markdown;charset=utf-8"
) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }))
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function safeFilename(title: string, extension: string): string {
  const base = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return `${base || "respuesta"}.${extension}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

/**
 * Opens the browser print dialog (Save as PDF) for already rendered HTML.
 * Returns false when the browser blocked the new window.
 */
export function printHtml(title: string, bodyHtml: string): boolean {
  const win = window.open("", "_blank")
  if (!win) return false
  win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<title>${escapeHtml(title)}</title>
<style>
  body { font: 14px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif; color: #111; max-width: 760px; margin: 32px auto; padding: 0 16px; }
  h1 { font-size: 20px; margin-bottom: 4px; }
  h2 { font-size: 16px; margin: 24px 0 6px; }
  table { border-collapse: collapse; } td, th { border: 1px solid #ccc; padding: 4px 8px; }
  button { all: unset; font-weight: 600; }
  .border-t { margin-top: 24px; border-top: 1px solid #ccc; padding-top: 8px; font-size: 13px; }
  .border-t ul { padding-left: 0; } .border-t li { list-style: none; margin: 4px 0; display: flex; gap: 6px; }
  .border-t p.uppercase { text-transform: uppercase; font-size: 11px; color: #666; letter-spacing: .05em; }
  a { color: inherit; text-decoration: none; }
  svg { display: none; }
</style></head><body>${bodyHtml}</body></html>`)
  win.document.close()
  win.focus()
  win.print()
  return true
}

import type { WebLookup } from "@/lib/web-search"

/** Web hits. They are not numbered and they are not library citations. */
export function WebSources({ lookup }: { lookup: WebLookup | null | undefined }) {
  if (!lookup || (!lookup.note && lookup.sources.length === 0)) return null

  return (
    <div className="mt-6 border-t border-border/80 pt-4" data-testid="web-sources">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Web
      </p>
      <p className="mb-3 text-xs text-muted-foreground">
        Resultados de la web, no de la biblioteca. No sustituyen las fuentes citadas arriba.
      </p>
      {lookup.note && <p className="mb-3 text-sm leading-6">{lookup.note}</p>}
      {lookup.sources.length > 0 && (
        <ul className="space-y-2">
          {lookup.sources.map((source) => (
            <li key={source.url} className="text-sm">
              <span className="mr-2 rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-medium uppercase text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100">
                Web
              </span>
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="break-all text-blue-700 underline underline-offset-2 hover:text-blue-900 dark:text-blue-300"
              >
                {source.title}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

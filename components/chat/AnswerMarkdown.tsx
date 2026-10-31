"use client"

import type { Components } from "react-markdown"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

import { linkCitations, stripFileCiteMarkers } from "@/lib/chat/references"
import { cn } from "@/lib/utils"

interface AnswerMarkdownProps {
  markdown: string
  /** Called with N when the user clicks a [N] marker. */
  onCitationClick?: (number: number) => void
  className?: string
}

const components = (
  onCitationClick?: (number: number) => void
): Components => ({
  h1: ({ children }) => (
    <h1 className="mb-3 mt-8 text-xl font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-7 text-lg font-semibold tracking-tight text-foreground first:mt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 mt-6 text-base font-semibold text-foreground first:mt-0">
      {children}
    </h3>
  ),
  h4: ({ children }) => (
    <h4 className="mb-1.5 mt-5 text-sm font-semibold text-foreground first:mt-0">
      {children}
    </h4>
  ),
  p: ({ children }) => (
    <p className="mb-3 text-[15.5px] leading-7 text-foreground/90 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-2 pl-5 text-[15.5px] leading-7 marker:text-muted-foreground">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-4 list-decimal space-y-4 pl-6 text-[15.5px] leading-7 marker:text-sm marker:font-semibold marker:text-muted-foreground">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-1 [&>p]:mb-1.5 [&>p]:mt-0">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-6 border-border" />,
  a({ href, children, ...rest }) {
    const cite = href?.match(/^#cite-(\d+)$/)
    if (cite) {
      const number = Number(cite[1])
      return (
        <button
          type="button"
          onClick={() => onCitationClick?.(number)}
          className="mx-0.5 inline-flex h-5 min-w-5 items-center justify-center rounded bg-blue-100 px-1 align-super text-[11px] font-semibold text-blue-800 hover:bg-blue-200 dark:bg-blue-950 dark:text-blue-100"
          aria-label={`Fuente ${number}`}
        >
          {number}
        </button>
      )
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-blue-700 underline decoration-blue-700/30 underline-offset-2 hover:decoration-blue-700 dark:text-blue-300"
        {...rest}
      >
        {children}
      </a>
    )
  },
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b px-2 py-2 text-left text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b px-2 py-2 align-top leading-6">{children}</td>
  ),
  pre: ({ children }) => (
    <pre className="my-4 overflow-x-auto rounded-lg bg-muted p-4 text-sm leading-6">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) => {
    const block = Boolean(className)
    if (block) {
      return (
        <code className={cn("font-mono text-[13px]", className)} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code
        className="rounded bg-muted px-1 py-0.5 font-mono text-[0.9em]"
        {...props}
      >
        {children}
      </code>
    )
  },
})

/** Markdown of an answer where [N] markers are clickable. */
export function AnswerMarkdown({
  markdown,
  onCitationClick,
  className,
}: AnswerMarkdownProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className={cn("max-w-none", className)}
      components={components(onCitationClick)}
    >
      {linkCitations(stripFileCiteMarkers(markdown))}
    </ReactMarkdown>
  )
}

/** Safe to show to an MCP client. Never put secrets or other teams' data in the message. */
export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ToolError"
  }
}

const SECRET_SHAPES = [
  new RegExp(["sk", "[A-Za-z0-9_-]{8,}"].join("-"), "g"),
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
  /sb_secret_[A-Za-z0-9_-]+/g,
]

/** Removes credential-shaped substrings before anything is logged. */
export function scrub(value: string): string {
  let out = value
  for (const pattern of SECRET_SHAPES) {
    out = out.replace(pattern, "[redacted]")
  }
  return out.slice(0, 500)
}

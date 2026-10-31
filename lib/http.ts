import { NextResponse } from "next/server"
import { ZodError } from "zod"

/** Error that maps directly to an HTTP response. */
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public details?: unknown
  ) {
    super(message)
    this.name = "HttpError"
  }
}

/**
 * Converts any thrown value into a JSON response. Unknown errors are logged and
 * returned as a generic 500 so internal details never leak to the client.
 */
export function errorResponse(error: unknown, context = "API") {
  if (error instanceof HttpError) {
    return NextResponse.json(
      { error: error.message, details: error.details },
      { status: error.status }
    )
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid request", details: error.flatten() },
      { status: 400 }
    )
  }
  console.error(`[${context}]`, error)
  return NextResponse.json({ error: "Internal server error" }, { status: 500 })
}

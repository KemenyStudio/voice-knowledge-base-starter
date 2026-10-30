import { handleMcp } from "@/lib/mcp/http"

export const dynamic = "force-dynamic"
export const runtime = "nodejs"
export const maxDuration = 60

export function GET(request: Request) {
  return handleMcp(request)
}

export function POST(request: Request) {
  return handleMcp(request)
}

export function DELETE(request: Request) {
  return handleMcp(request)
}

export function OPTIONS(request: Request) {
  return handleMcp(request)
}

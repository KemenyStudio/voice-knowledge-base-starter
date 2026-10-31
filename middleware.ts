import { createMiddlewareClient } from "@supabase/auth-helpers-nextjs"
import { NextResponse } from "next/server"

import type { NextRequest } from "next/server"
import type { Database } from "@/lib/database.types"

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname
  // Remote agents authenticate with the MCP API key inside the route.
  if (path === "/api/mcp" || path.startsWith("/api/mcp/")) {
    return NextResponse.next()
  }

  // The iOS app sends its Supabase access token instead of a cookie;
  // requireUser() verifies it inside the route.
  if (path.startsWith("/api/") && /^Bearer\s+\S+$/i.test(req.headers.get("authorization") ?? "")) {
    return NextResponse.next()
  }

  // Local computer-use fixture. Off unless COMPUTER_USE_FIXTURE=1, and the
  // route itself rejects any host that is not loopback.
  if (
    process.env.COMPUTER_USE_FIXTURE === "1" &&
    (path === "/harness/kb" || path === "/api/harness/kb")
  ) {
    return NextResponse.next()
  }

  const res = NextResponse.next()
  const supabase = createMiddlewareClient<Database>({ req, res })

  const {
    data: { session },
  } = await supabase.auth.getSession()

  // Función para verificar si una ruta es pública
  const isPublicRoute = (path: string) => {
    const staticRoutes = [
      "/login",
      "/register",
      "/terminos",
      "/privacidad",
      "/reset-password",
      "/reset-password/confirm",
      "/api/mobile/config",
    ]
    return staticRoutes.includes(path) || path.startsWith("/invitation")
  }

  // Si no hay sesión y la ruta no es pública, redirigir al login
  if (!session && !isPublicRoute(path)) {
    if (path.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    const redirectUrl = new URL("/login", req.url)
    if (path !== "/") redirectUrl.searchParams.set("next", path + req.nextUrl.search)
    return NextResponse.redirect(redirectUrl)
  }

  return res
}

// Ensure the middleware is only called for relevant paths.
export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, icon, apple-icon (browser icons)
     */
    "/((?!_next/static|_next/image|favicon.ico|icon|apple-icon).*)",
  ],
}

import { NextResponse } from "next/server"

export const dynamic = "force-dynamic"

/**
 * Public settings the iOS app needs before sign-in: the Supabase project it
 * signs in to. Both values already ship to every browser.
 */
export function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { error: "Supabase public env vars are missing" },
      { status: 500 }
    )
  }
  return NextResponse.json({
    appName: process.env.NEXT_PUBLIC_APP_NAME || "Document Search",
    supabaseUrl,
    supabaseAnonKey,
  })
}

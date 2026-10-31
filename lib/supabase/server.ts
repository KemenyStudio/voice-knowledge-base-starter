import {
  createRouteHandlerClient,
  createServerActionClient,
} from "@supabase/auth-helpers-nextjs"
import { createClient, SupabaseClient, User } from "@supabase/supabase-js"
import { cookies, headers } from "next/headers"

import { HttpError } from "@/lib/http"

// The generated Database type does not know the columns added by the
// multi-team migration yet, so these helpers use untyped clients and the
// row interfaces in types/knowledge.ts.
export type AnySupabase = SupabaseClient<any, "public", any>

export interface AuthContext {
  /** Client scoped to the signed-in user (RLS applies). */
  supabase: AnySupabase
  user: User
}

/**
 * Resolves the signed-in user from the session cookie, or from an
 * `Authorization: Bearer <Supabase access token>` header (the iOS app). The
 * user is verified with Supabase Auth (getUser), never trusted from the
 * request body. Use in route handlers.
 */
export async function requireUser(): Promise<AuthContext> {
  const token = bearerToken()
  if (token) return userFromAccessToken(token)
  const supabase = createRouteHandlerClient({ cookies }) as AnySupabase
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new HttpError(401, "Unauthorized")
  return { supabase, user }
}

/** Supabase access token sent by a native client, or null. */
function bearerToken(): string | null {
  const match = /^Bearer\s+(\S+)$/i.exec(headers().get("authorization") ?? "")
  return match ? match[1] : null
}

/** Client that acts as the token's user, so RLS applies as in the browser. */
async function userFromAccessToken(token: string): Promise<AuthContext> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error("Supabase public env vars are missing")
  const supabase = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as AnySupabase
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token)
  if (error || !user) throw new HttpError(401, "Unauthorized")
  return { supabase, user }
}

/** Same as requireUser() but for Server Actions. */
export async function requireUserInAction(): Promise<AuthContext> {
  const supabase = createServerActionClient({ cookies }) as AnySupabase
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) throw new HttpError(401, "Unauthorized")
  return { supabase, user }
}

let adminClient: AnySupabase | null = null

/**
 * Service-role client. Bypasses RLS: server-only, and only AFTER the caller has
 * been authenticated and authorized with the user-scoped client.
 */
export function getAdminClient(): AnySupabase {
  if (adminClient) return adminClient
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY (and NEXT_PUBLIC_SUPABASE_URL) must be set on the server"
    )
  }
  adminClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return adminClient
}

/** Anonymous client with no session, for sign-up performed on the server. */
export function getAnonClient(): AnySupabase {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error("Supabase public env vars are missing")
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

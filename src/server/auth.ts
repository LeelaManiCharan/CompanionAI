/**
 * Route session check (Req 22.6, 22.7).
 *
 * `requireUser()` builds a cookie-bound server client and calls
 * `auth.getUser()`, which revalidates the session with Supabase instead of
 * trusting the cookie JWT. When the Supabase env vars are missing it reports
 * `not_configured` so the routes can answer 503 instead of crashing (22.9).
 */
import { createServerSupabase } from "@/lib/supabase/server";

export type AuthCheck =
  | { ok: true; user: { id: string } }
  | { ok: false; reason: "unauthorized" | "not_configured" };

export type RequireUser = () => Promise<AuthCheck>;

export const requireUser: RequireUser = async () => {
  try {
    const sb = await createServerSupabase();
    if (!sb) return { ok: false, reason: "not_configured" };
    const { data, error } = await sb.auth.getUser();
    const id = data?.user?.id;
    if (error || typeof id !== "string" || id === "") return { ok: false, reason: "unauthorized" };
    return { ok: true, user: { id } };
  } catch {
    return { ok: false, reason: "unauthorized" };
  }
};

/** Limiter key for a verified user (22.7). */
export function userLimiterKey(id: string): string {
  return `user:${id}`;
}

const HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

/** 401 `unauthorized` or 503 `supabase_not_configured`. */
export function authFailureResponse(reason: "unauthorized" | "not_configured"): Response {
  const body =
    reason === "not_configured"
      ? { error: { code: "supabase_not_configured", message: "Sign-in is not configured on this deployment." } }
      : { error: { code: "unauthorized", message: "Sign in to continue." } };
  return new Response(JSON.stringify(body), {
    status: reason === "not_configured" ? 503 : 401,
    headers: HEADERS,
  });
}

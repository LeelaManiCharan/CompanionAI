import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseEnv, isSupabaseEnvMissing } from "./env";

export type UpdateSessionResult = {
  response: NextResponse;
  user: User | null;
  /** True when the Supabase env vars are missing; nothing was sent to Supabase. */
  envMissing: boolean;
};

/**
 * Refreshes the Supabase cookie session for this request (22.5). Any refreshed
 * auth cookies are written to both the forwarded request and the returned
 * response, so downstream handlers and the browser see the same session.
 * When the env is missing it passes the request through untouched (22.9).
 */
export async function updateSession(req: NextRequest): Promise<UpdateSessionResult> {
  let response = NextResponse.next({ request: req });

  const env = getSupabaseEnv();
  if (isSupabaseEnvMissing(env)) return { response, user: null, envMissing: true };

  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) req.cookies.set(name, value);
        response = NextResponse.next({ request: req });
        for (const { name, value, options } of cookiesToSet) response.cookies.set(name, value, options);
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });

  // getUser() revalidates with Supabase rather than trusting the cookie JWT.
  let user: User | null = null;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }

  return { response, user, envMissing: false };
}

/** Builds a redirect that keeps any refreshed auth cookies from `from`. */
export function redirectWithCookies(url: URL, from: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  const cacheControl = from.headers.get("cache-control");
  if (cacheControl) redirect.headers.set("cache-control", cacheControl);
  return redirect;
}

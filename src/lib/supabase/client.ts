"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv, isSupabaseEnvMissing } from "./env";

let browserClient: SupabaseClient | null = null;

/**
 * Memoized browser Supabase client (cookie session shared with the middleware
 * and route handlers). Returns `null` when the Supabase env vars are missing,
 * so callers can show the Setup_Screen instead of crashing (22.9).
 */
export function getBrowserSupabase(): SupabaseClient | null {
  if (browserClient) return browserClient;
  const env = getSupabaseEnv();
  if (isSupabaseEnvMissing(env)) return null;
  browserClient = createBrowserClient(env.url, env.anonKey);
  return browserClient;
}

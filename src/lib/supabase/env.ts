/**
 * Supabase environment config (22.8, 22.9).
 *
 * The `process.env.NEXT_PUBLIC_*` reads must stay literal property accesses so
 * Next.js can inline them into the client bundle at build time.
 */

export type SupabaseEnv = { url: string; anonKey: string };
export type SupabaseEnvResult = SupabaseEnv | { missing: string[] };

export function getSupabaseEnv(): SupabaseEnvResult {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const anonKey = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

  const missing: string[] = [];
  if (!url) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!anonKey) missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  if (missing.length > 0) return { missing };
  return { url, anonKey };
}

export function isSupabaseEnvMissing(env: SupabaseEnvResult): env is { missing: string[] } {
  return "missing" in env;
}

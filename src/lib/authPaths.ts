/** Public_Auth_Pages: reachable without a session (22.5). */
export const PUBLIC_AUTH_PATHS = ["/login", "/signup", "/reset-password"] as const;

/** Signed-in users are sent home from these. /reset-password stays open for recovery visits. */
export const SIGNED_IN_REDIRECT_PATHS = ["/login", "/signup"] as const;

export function matchesPath(pathname: string, paths: readonly string[]): boolean {
  return paths.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function isPublicAuthPath(pathname: string): boolean {
  return matchesPath(pathname, PUBLIC_AUTH_PATHS);
}

/**
 * The post-sign-in destination from a `next` query value (22.2). Only
 * same-origin absolute paths are accepted (no `//host`, no backslashes, no
 * auth pages), so the parameter can't be used as an open redirect.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  const pathname = next.split(/[?#]/, 1)[0] ?? "/";
  if (isPublicAuthPath(pathname)) return "/";
  return next;
}

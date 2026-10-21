import type { NextRequest } from "next/server";
import { matchesPath, PUBLIC_AUTH_PATHS as PUBLIC_PATHS, SIGNED_IN_REDIRECT_PATHS } from "@/lib/authPaths";
import { redirectWithCookies, updateSession } from "@/lib/supabase/middleware";

/**
 * Auth_Middleware (22.5, 22.9). Refreshes the cookie session on every page
 * request and gates the whole app behind sign-in. API routes are never
 * redirected (they return 401 themselves), and when the Supabase env is
 * missing every request passes through to the Setup_Screen.
 */
export async function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  const { response, user, envMissing } = await updateSession(req);
  if (envMissing || pathname.startsWith("/api/")) return response;

  const isPublic = matchesPath(pathname, PUBLIC_PATHS);

  if (!user && !isPublic) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", `${pathname}${search}`);
    return redirectWithCookies(url, response);
  }

  if (user && matchesPath(pathname, SIGNED_IN_REDIRECT_PATHS)) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return redirectWithCookies(url, response);
  }

  return response;
}

export const config = {
  matcher: [
    // Skip API routes, Next internals, the service worker, and static image files.
    "/((?!api/|_next/static|_next/image|favicon.ico|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};

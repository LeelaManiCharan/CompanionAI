/**
 * Provider_Status_Route: GET /api/provider-status (Req 6A.8, 6A.14, 21.3).
 * Requires a signed-in user (22.6): 401 `unauthorized`, or 503
 * `supabase_not_configured` when the Supabase env vars are missing.
 * Returns only `{ geminiAvailable, model }`; never the key or any part of it.
 */
import { requireUser } from "@/server/auth";
import { handleProviderStatus } from "@/server/providerStatus";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = "no-store";

export function GET(): Promise<Response> {
  return handleProviderStatus({ env: process.env, requireUser });
}

function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({ error: { code: "method_not_allowed", message: "Only GET is allowed." } }),
    {
      status: 405,
      headers: {
        allow: "GET",
        "content-type": "application/json; charset=utf-8",
        "cache-control": NO_STORE,
      },
    },
  );
}

export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;

/**
 * Generate_Route: POST /api/generate (Req 6A). No user authentication; the
 * in-memory Rate_Limiter is best-effort only (6A.13).
 */
import { handleGenerate } from "@/server/handleGenerate";
import { createRateLimiter } from "@/server/rateLimiter";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

// Module-level so state persists across requests within one server instance.
const limiter = createRateLimiter();

export function POST(req: Request): Promise<Response> {
  return handleGenerate(req, {
    env: process.env,
    fetch: globalThis.fetch,
    now: Date.now,
    limiter,
  });
}

function methodNotAllowed(): Response {
  return new Response(
    JSON.stringify({ error: { code: "method_not_allowed", message: "Only POST is allowed." } }),
    {
      status: 405,
      headers: {
        allow: "POST",
        "content-type": "application/json; charset=utf-8",
        "cache-control": "no-store",
      },
    },
  );
}

export const GET = methodNotAllowed;
export const PUT = methodNotAllowed;
export const PATCH = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const HEAD = methodNotAllowed;
export const OPTIONS = methodNotAllowed;

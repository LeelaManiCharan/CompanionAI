/**
 * Provider_Status_Route: GET /api/provider-status (Req 6A.8, 6A.14, 21.3).
 * Returns only `{ geminiAvailable, model }`; never the key or any part of it.
 */
import { geminiModel } from "@/server/gemini";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = "no-store";

export function GET(): Response {
  const geminiAvailable = (process.env.GEMINI_API_KEY?.trim() ?? "") !== "";
  return new Response(
    JSON.stringify({ geminiAvailable, model: geminiModel(process.env) }),
    {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": NO_STORE },
    },
  );
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

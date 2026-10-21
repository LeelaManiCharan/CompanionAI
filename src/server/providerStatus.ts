/**
 * GET pipeline for the Provider_Status_Route (Req 6A.8, 6A.14, 21.3, 22.6).
 * Returns only `{ geminiAvailable, model }`; never the key or any part of it.
 */
import { authFailureResponse, type RequireUser } from "./auth";
import { geminiModel } from "./gemini";

export interface ProviderStatusDeps {
  env: Record<string, string | undefined>;
  requireUser: RequireUser;
}

export async function handleProviderStatus(deps: ProviderStatusDeps): Promise<Response> {
  const auth = await deps.requireUser();
  if (!auth.ok) return authFailureResponse(auth.reason);

  const geminiAvailable = (deps.env.GEMINI_API_KEY?.trim() ?? "") !== "";
  return new Response(JSON.stringify({ geminiAvailable, model: geminiModel(deps.env) }), {
    status: 200,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

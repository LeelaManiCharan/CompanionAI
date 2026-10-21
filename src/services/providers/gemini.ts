/**
 * GeminiProxyProvider: browser → same-origin `/api/generate` only (Req 6.15–6.19).
 * The browser never calls a Google endpoint and never sees the key.
 *
 * Status mapping:
 *   401 → `unauthorized` (session expired; UI links to /login, 22.6)
 *   429 → `busy` (code from body `error.code`, `Retry-After` header)
 *   503 → `unavailable` (not configured)
 *   504 / timeout abort → `timeout`
 *   anything else non-2xx → `upstream`
 */
import type { GenerationRequest } from "@/core/generation";
import { abortError, ProviderError, type BusyCode, type ModelProvider } from "./types";

/** Relative URLs only: always the Companion_App's own origin (6.15). */
export const GENERATE_PATH = "/api/generate";
export const PROVIDER_STATUS_PATH = "/api/provider-status";

export interface ProviderStatus {
  geminiAvailable: boolean;
  model: string;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? Math.ceil(n) : undefined;
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    const body = (await res.json()) as { error?: { code?: unknown } } | null;
    const code = body?.error?.code;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
}

export async function geminiGenerate(req: GenerationRequest, signal: AbortSignal): Promise<string> {
  if (signal.aborted) throw abortError(signal, "gemini");

  let res: Response;
  try {
    res = await fetch(GENERATE_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ task: req.task, system: req.system, messages: req.messages }),
      signal,
      credentials: "same-origin",
    });
  } catch {
    if (signal.aborted) throw abortError(signal, "gemini");
    throw new ProviderError({ kind: "upstream", provider: "gemini" });
  }

  try {
    if (res.status === 429) {
      const code: BusyCode =
        (await errorCode(res)) === "rate_limited_local" ? "rate_limited_local" : "gemini_quota";
      const retryAfterS = parseRetryAfter(res.headers.get("retry-after"));
      throw new ProviderError(
        retryAfterS === undefined
          ? { kind: "busy", provider: "gemini", code }
          : { kind: "busy", provider: "gemini", code, retryAfterS },
      );
    }
    if (res.status === 401) {
      throw new ProviderError({ kind: "unauthorized", provider: "gemini" });
    }
    if (res.status === 503) {
      throw new ProviderError({ kind: "unavailable", provider: "gemini", reason: "not_configured" });
    }
    if (res.status === 504) throw new ProviderError({ kind: "timeout", provider: "gemini" });
    if (!res.ok) throw new ProviderError({ kind: "upstream", provider: "gemini", status: res.status });

    const data = (await res.json()) as { text?: unknown } | null;
    if (typeof data?.text !== "string") {
      throw new ProviderError({ kind: "upstream", provider: "gemini", status: res.status });
    }
    return data.text;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (signal.aborted) throw abortError(signal, "gemini");
    throw new ProviderError({ kind: "upstream", provider: "gemini", status: res.status });
  }
}

/**
 * GET the Provider_Status_Route (6.16, 6.17). Any failure (network, non-2xx,
 * malformed body) reports gemini as unavailable.
 */
export async function fetchProviderStatus(signal?: AbortSignal): Promise<ProviderStatus> {
  try {
    const res = await fetch(PROVIDER_STATUS_PATH, {
      method: "GET",
      cache: "no-store",
      credentials: "same-origin",
      signal,
    });
    if (!res.ok) return { geminiAvailable: false, model: "" };
    const data = (await res.json()) as { geminiAvailable?: unknown; model?: unknown } | null;
    return {
      geminiAvailable: data?.geminiAvailable === true,
      model: typeof data?.model === "string" ? data.model : "",
    };
  } catch {
    return { geminiAvailable: false, model: "" };
  }
}

export class GeminiProxyProvider implements ModelProvider {
  readonly id = "gemini" as const;

  generate(req: GenerationRequest, signal: AbortSignal): Promise<string> {
    return geminiGenerate(req, signal);
  }
}

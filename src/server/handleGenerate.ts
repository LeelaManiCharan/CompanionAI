/**
 * POST pipeline for the Generate_Route (Req 6A.1–6A.12, 21.3).
 *
 * Order: 415 → 503 → 429 (local) → 413 → 400 → upstream (504 / 429 / 502 / 200).
 * Unexpected exceptions are caught at the top level and return 500.
 *
 * Key hygiene: the key is read from the injected env inside the handler and is
 * only handed to `callGemini`, which places it in a header. No response body,
 * header, or log entry ever contains the key, the upstream URL, or upstream
 * error bodies. `safeLog` is the only logger.
 */
import type { Task } from "@/core/generation";
import { callGemini, geminiModel } from "./gemini";
import { clientIp, type RateLimiter } from "./rateLimiter";
import { safeLog } from "./safeLog";
import { GenerateRequestSchema, issueFields } from "./schema";

export const GENERATE_ROUTE = "/api/generate";
export const MAX_BODY_BYTES = 65_536;
export const UPSTREAM_TIMEOUT_MS = 50_000;

export type GenerateErrorCode =
  | "unsupported_media_type"
  | "gemini_not_configured"
  | "rate_limited_local"
  | "payload_too_large"
  | "invalid_json"
  | "invalid_request"
  | "upstream_timeout"
  | "gemini_quota"
  | "upstream_error"
  | "internal_error";

const MESSAGES: Record<GenerateErrorCode, string> = {
  unsupported_media_type: "Content-Type must be application/json.",
  gemini_not_configured: "The hosted model is not configured on this deployment.",
  rate_limited_local: "Too many requests. Please try again later.",
  payload_too_large: "Request body is too large.",
  invalid_json: "Request body is not valid JSON.",
  invalid_request: "Request body failed validation.",
  upstream_timeout: "The hosted model did not respond in time.",
  gemini_quota: "The hosted model is busy or its quota is reached.",
  upstream_error: "The hosted model returned an error.",
  internal_error: "Internal server error.",
};

export interface GenerateDeps {
  env: Record<string, string | undefined>;
  fetch: typeof fetch;
  now: () => number;
  limiter: RateLimiter;
  /** Upstream abort timeout; defaults to 50 s (6A.9). Overridable for tests. */
  timeoutMs?: number;
}

const BASE_HEADERS: Record<string, string> = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...BASE_HEADERS, ...extra },
  });
}

function errorBody(code: GenerateErrorCode, fields?: string[]) {
  return {
    error: fields ? { code, message: MESSAGES[code], fields } : { code, message: MESSAGES[code] },
  };
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const media = value.split(";")[0]?.trim().toLowerCase();
  return media === "application/json";
}

class TooLargeError extends Error {}

/** Reads the body as UTF-8, aborting once more than `max` bytes arrive. */
async function readBodyCapped(req: Request, max: number): Promise<string> {
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > max) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new TooLargeError();
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

function upstreamSignal(req: Request, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return req.signal ? AbortSignal.any([timeout, req.signal]) : timeout;
}

export async function handleGenerate(req: Request, deps: GenerateDeps): Promise<Response> {
  const start = deps.now();
  let task: Task | undefined;

  const respond = (
    status: number,
    body: unknown,
    code?: GenerateErrorCode,
    extra?: Record<string, string>,
  ): Response => {
    safeLog({ route: GENERATE_ROUTE, status, code, task, ms: Math.max(0, deps.now() - start) });
    return json(status, body, extra);
  };
  const fail = (
    status: number,
    code: GenerateErrorCode,
    fields?: string[],
    extra?: Record<string, string>,
  ) => respond(status, errorBody(code, fields), code, extra);

  try {
    // 1. Content-Type (6A.1)
    if (!isJsonContentType(req.headers.get("content-type"))) {
      return fail(415, "unsupported_media_type");
    }

    // 2. Key configured (6A.8)
    const apiKey = deps.env.GEMINI_API_KEY?.trim() ?? "";
    if (apiKey === "") return fail(503, "gemini_not_configured");

    // 3. Local rate limit (6A.5, 6A.6)
    const rl = deps.limiter.check(clientIp(req.headers));
    if (!rl.allowed) {
      return fail(429, "rate_limited_local", undefined, {
        "retry-after": String(rl.retryAfterS),
      });
    }

    // 4. Size cap (6A.2): declared length first, then streamed byte count.
    const declared = req.headers.get("content-length");
    if (declared !== null && declared.trim() !== "") {
      const n = Number(declared);
      if (Number.isFinite(n) && n > MAX_BODY_BYTES) return fail(413, "payload_too_large");
    }
    let raw: string;
    try {
      raw = await readBodyCapped(req, MAX_BODY_BYTES);
    } catch (err) {
      if (err instanceof TooLargeError) return fail(413, "payload_too_large");
      throw err;
    }

    // 5. Parse + validate (6A.3, 6A.4)
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return fail(400, "invalid_json");
    }
    const result = GenerateRequestSchema.safeParse(parsed);
    if (!result.success) return fail(400, "invalid_request", issueFields(result.error));
    task = result.data.task;

    // 6. Upstream (6A.7, 6A.9, 6A.10, 21.3)
    const out = await callGemini({
      apiKey,
      model: geminiModel(deps.env),
      req: result.data,
      fetch: deps.fetch,
      signal: upstreamSignal(req, deps.timeoutMs ?? UPSTREAM_TIMEOUT_MS),
    });
    if (out.ok) return respond(200, { text: out.text });
    if (out.kind === "timeout") return fail(504, "upstream_timeout");
    if (out.kind === "quota") return fail(429, "gemini_quota");
    return fail(502, "upstream_error");
  } catch {
    return fail(500, "internal_error");
  }
}

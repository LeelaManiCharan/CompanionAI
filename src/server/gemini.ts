/**
 * Gemini upstream helpers for the Generate_Route (Req 6A.7, 6A.9, 6A.10, 6A.11, 21.3).
 *
 * Key hygiene: the API key is only ever placed in the `x-goog-api-key` header.
 * It is never interpolated into a URL, string, log line, or return value.
 * Upstream bodies are only inspected for RESOURCE_EXHAUSTED and then dropped.
 */
import { JSON_TASKS, type GenerationRequest, type Task } from "@/core/generation";

export const DEFAULT_GEMINI_MODEL = "gemini-flash-latest";
/** Separate free-tier quota from gemini-flash-latest; used as fallback and for background tasks. */
export const DEFAULT_GEMINI_FALLBACK_MODELS = ["gemini-flash-lite-latest"];
export const DEFAULT_GEMINI_LITE_MODEL = "gemini-flash-lite-latest";
/** Cooldown after a 429 when Google sends no RetryInfo. */
export const DEFAULT_QUOTA_COOLDOWN_S = 60;
export const GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
export const SYNTHETIC_START = "(conversation start)";

export interface GeminiContent {
  role: "user" | "model";
  parts: { text: string }[];
}

export interface GeminiBody {
  systemInstruction: { parts: { text: string }[] };
  contents: GeminiContent[];
  generationConfig?: { responseMimeType: string };
}

export type GeminiResult =
  | { ok: true; text: string }
  | { ok: false; kind: "quota"; status?: number; retryAfterS?: number }
  | { ok: false; kind: "upstream" | "timeout"; status?: number };

/** GEMINI_MODEL, defaulting to gemini-flash-latest when unset or blank (21.3). */
export function geminiModel(env: Record<string, string | undefined>): string {
  const m = env.GEMINI_MODEL?.trim();
  return m ? m : DEFAULT_GEMINI_MODEL;
}

/** Background tasks that prefer the cheaper lite model. */
const LITE_TASKS: ReadonlySet<Task> = new Set<Task>([
  "extract_reminder",
  "extract_memories",
  "summarize",
  "test",
]);

function parseList(value: string | undefined, fallback: readonly string[]): string[] {
  if (value === undefined) return [...fallback];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/**
 * Ordered, de-duplicated model chain for a task:
 * reply → [GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS];
 * background tasks → [GEMINI_LITE_MODEL, GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS].
 */
export function geminiModelChain(env: Record<string, string | undefined>, task: Task): string[] {
  const chain = [geminiModel(env), ...parseList(env.GEMINI_FALLBACK_MODELS, DEFAULT_GEMINI_FALLBACK_MODELS)];
  if (LITE_TASKS.has(task)) {
    const lite = env.GEMINI_LITE_MODEL?.trim();
    chain.unshift(lite ? lite : DEFAULT_GEMINI_LITE_MODEL);
  }
  return [...new Set(chain)];
}

/** Per-model quota cooldowns (in-memory, per server instance). */
export interface ModelCooldowns {
  /** Remaining cooldown in ms, 0 when usable. */
  remainingMs(model: string, now: number): number;
  mark(model: string, now: number, seconds: number): void;
}

export function createModelCooldowns(): ModelCooldowns {
  const until = new Map<string, number>();
  return {
    remainingMs(model, now) {
      const t = until.get(model);
      if (t === undefined) return 0;
      if (t <= now) {
        until.delete(model);
        return 0;
      }
      return t - now;
    },
    mark(model, now, seconds) {
      until.set(model, now + Math.max(1, seconds) * 1000);
    },
  };
}

/** Parses `RetryInfo.retryDelay` (e.g. "37s" or "1.5s") from an upstream error body. */
export function parseRetryDelay(raw: string): number | undefined {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(raw);
  if (!m) return undefined;
  const n = Math.ceil(Number(m[1]));
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function toGeminiBody(req: GenerationRequest): GeminiBody {
  const contents: GeminiContent[] = [];
  for (const msg of req.messages) {
    const role = msg.role === "companion" ? "model" : "user";
    const last = contents[contents.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += "\n\n" + msg.content;
    } else {
      contents.push({ role, parts: [{ text: msg.content }] });
    }
  }
  if (contents[0]?.role === "model") {
    contents.unshift({ role: "user", parts: [{ text: SYNTHETIC_START }] });
  }
  const body: GeminiBody = {
    systemInstruction: { parts: [{ text: req.system }] },
    contents,
  };
  if (JSON_TASKS.has(req.task)) {
    body.generationConfig = { responseMimeType: "application/json" };
  }
  return body;
}

export interface CallGeminiArgs {
  apiKey: string;
  model: string;
  req: GenerationRequest;
  fetch: typeof fetch;
  signal?: AbortSignal;
}

function isAbort(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "name" in err &&
    ((err as { name: unknown }).name === "AbortError" ||
      (err as { name: unknown }).name === "TimeoutError")
  );
}

function extractText(json: unknown): string | null {
  const parts = (json as {
    candidates?: { content?: { parts?: { text?: unknown }[] } }[];
  })?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  const text = parts
    .map((p) => (typeof p?.text === "string" ? p.text : ""))
    .join("");
  return text.length > 0 ? text : null;
}

export async function callGemini(args: CallGeminiArgs): Promise<GeminiResult> {
  const url = `${GEMINI_BASE_URL}/${encodeURIComponent(args.model)}:generateContent`;
  let res: Response;
  try {
    res = await args.fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": args.apiKey,
      },
      body: JSON.stringify(toGeminiBody(args.req)),
      signal: args.signal,
    });
  } catch (err) {
    if (isAbort(err) || args.signal?.aborted) return { ok: false, kind: "timeout" };
    return { ok: false, kind: "upstream" };
  }

  try {
    if (!res.ok) {
      // 404 = model not found / retired (e.g. GEMINI_MODEL is stale): never quota.
      if (res.status === 404) return { ok: false, kind: "upstream", status: 404 };
      let raw = "";
      try {
        raw = await res.text();
      } catch {
        /* body dropped */
      }
      if (res.status === 429 || raw.includes("RESOURCE_EXHAUSTED")) {
        // Only the numeric retry delay leaves this function; the body is dropped.
        const retryAfterS = parseRetryDelay(raw);
        return retryAfterS === undefined
          ? { ok: false, kind: "quota", status: res.status }
          : { ok: false, kind: "quota", status: res.status, retryAfterS };
      }
      return { ok: false, kind: "upstream", status: res.status };
    }
    const json: unknown = await res.json();
    const text = extractText(json);
    if (text === null) return { ok: false, kind: "upstream", status: res.status };
    return { ok: true, text };
  } catch (err) {
    if (isAbort(err) || args.signal?.aborted) return { ok: false, kind: "timeout" };
    return { ok: false, kind: "upstream", status: res.status };
  }
}

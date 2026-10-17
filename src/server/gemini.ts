/**
 * Gemini upstream helpers for the Generate_Route (Req 6A.7, 6A.9, 6A.10, 6A.11, 21.3).
 *
 * Key hygiene: the API key is only ever placed in the `x-goog-api-key` header.
 * It is never interpolated into a URL, string, log line, or return value.
 * Upstream bodies are only inspected for RESOURCE_EXHAUSTED and then dropped.
 */
import type { GenerationRequest } from "@/core/generation";

export const DEFAULT_GEMINI_MODEL = "gemini-2.0-flash";
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
  | { ok: false; kind: "quota" | "upstream" | "timeout"; status?: number };

/** GEMINI_MODEL, defaulting to gemini-2.0-flash when unset or blank (21.3). */
export function geminiModel(env: Record<string, string | undefined>): string {
  const m = env.GEMINI_MODEL?.trim();
  return m ? m : DEFAULT_GEMINI_MODEL;
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
  if (req.task === "extract_memories") {
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
      if (res.status === 429) return { ok: false, kind: "quota", status: 429 };
      let raw = "";
      try {
        raw = await res.text();
      } catch {
        /* body dropped */
      }
      if (raw.includes("RESOURCE_EXHAUSTED")) {
        return { ok: false, kind: "quota", status: res.status };
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

/**
 * OllamaProvider: browser → `{baseUrl}/api/chat` (Req 6.3, 6.4, 6.9–6.13).
 *
 * - `system` is prepended as the first message; `companion` maps to `assistant`.
 * - `format: "json"` is requested for `extract_memories`.
 * - fetch TypeError (refused / CORS / Local Network Access denial) → `unreachable`.
 * - HTTP 404 whose body mentions "not found" → `model_not_installed`.
 * - Abort via timeout → `timeout`; caller cancellation re-throws the AbortError.
 */
import { JSON_TASKS, type GenerationRequest } from "@/core/generation";
import { abortError, ProviderError, type ModelProvider } from "./types";

export const OLLAMA_HEALTH_TIMEOUT_MS = 2_000;

export interface OllamaConfig {
  baseUrl: string;
  model: string;
}

type OllamaRole = "system" | "user" | "assistant";

interface OllamaChatBody {
  model: string;
  messages: { role: OllamaRole; content: string }[];
  stream: false;
  format?: "json";
}

/** Joins a base URL and path without doubling slashes. */
export function ollamaUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${path}`;
}

export function toOllamaBody(model: string, req: GenerationRequest): OllamaChatBody {
  const body: OllamaChatBody = {
    model,
    messages: [
      { role: "system", content: req.system },
      ...req.messages.map((m) => ({
        role: (m.role === "companion" ? "assistant" : "user") as OllamaRole,
        content: m.content,
      })),
    ],
    stream: false,
  };
  if (JSON_TASKS.has(req.task)) body.format = "json";
  return body;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

export async function ollamaGenerate(
  cfg: OllamaConfig,
  req: GenerationRequest,
  signal: AbortSignal,
): Promise<string> {
  if (signal.aborted) throw abortError(signal, "ollama");

  let res: Response;
  try {
    res = await fetch(ollamaUrl(cfg.baseUrl, "/api/chat"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(toOllamaBody(cfg.model, req)),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw abortError(signal, "ollama");
    if (err instanceof TypeError) throw new ProviderError({ kind: "unreachable", provider: "ollama" });
    throw new ProviderError({ kind: "upstream", provider: "ollama" });
  }

  try {
    if (!res.ok) {
      const text = await safeText(res);
      if (res.status === 404 && /not found/i.test(text)) {
        throw new ProviderError({ kind: "model_not_installed", provider: "ollama", model: cfg.model });
      }
      throw new ProviderError({ kind: "upstream", provider: "ollama", status: res.status });
    }

    let data: unknown;
    try {
      data = await res.json();
    } catch {
      if (signal.aborted) throw abortError(signal, "ollama");
      throw new ProviderError({ kind: "upstream", provider: "ollama", status: res.status });
    }
    const content = (data as { message?: { content?: unknown } } | null)?.message?.content;
    if (typeof content !== "string") {
      throw new ProviderError({ kind: "upstream", provider: "ollama", status: res.status });
    }
    return content;
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    if (signal.aborted) throw abortError(signal, "ollama");
    throw new ProviderError({ kind: "upstream", provider: "ollama", status: res.status });
  }
}

/**
 * Ollama_Health_Check: GET `{baseUrl}/api/tags`, healthy on 2xx within 2 s.
 * Never throws.
 */
export async function ollamaHealthCheck(baseUrl: string, signal?: AbortSignal): Promise<boolean> {
  if (baseUrl.trim() === "") return false;
  const timeout = AbortSignal.timeout(OLLAMA_HEALTH_TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([timeout, signal]) : timeout;
  try {
    const res = await fetch(ollamaUrl(baseUrl, "/api/tags"), { method: "GET", signal: combined });
    return res.ok;
  } catch {
    return false;
  }
}

export class OllamaProvider implements ModelProvider {
  readonly id = "ollama" as const;

  constructor(private readonly cfg: OllamaConfig) {}

  generate(req: GenerationRequest, signal: AbortSignal): Promise<string> {
    return ollamaGenerate(this.cfg, req, signal);
  }
}

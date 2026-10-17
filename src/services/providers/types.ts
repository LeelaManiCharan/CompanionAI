/**
 * Shared provider contracts and the typed ProviderError (Req 6, 6A; design
 * "Model_Router and providers"). Lives beside the providers so they can throw
 * typed errors without importing the router (no import cycle).
 */
import type { GenerationRequest, ProviderId } from "@/core/generation";

export interface ModelProvider {
  readonly id: ProviderId;
  generate(req: GenerationRequest, signal: AbortSignal): Promise<string>;
}

export type BusyCode = "rate_limited_local" | "gemini_quota";

export type ProviderErrorInfo =
  | { kind: "unreachable"; provider: "ollama" } // TypeError: refused / CORS / LNA
  | { kind: "model_not_installed"; provider: "ollama"; model: string }
  | { kind: "timeout"; provider: ProviderId }
  | { kind: "busy"; provider: "gemini"; code: BusyCode; retryAfterS?: number }
  // 503 / status route says no key / offline
  | { kind: "unavailable"; provider: "gemini"; reason?: "not_configured" | "offline" }
  | { kind: "notice_declined" } // 6.22
  | { kind: "no_model" } // 6.20
  | { kind: "upstream"; provider: ProviderId; status?: number };

export type ProviderErrorKind = ProviderErrorInfo["kind"];

export class ProviderError extends Error {
  readonly info: ProviderErrorInfo;

  constructor(info: ProviderErrorInfo) {
    super(`provider_error:${info.kind}`);
    this.name = "ProviderError";
    this.info = info;
  }

  get kind(): ProviderErrorKind {
    return this.info.kind;
  }
}

export function isProviderError(err: unknown): err is ProviderError {
  return err instanceof ProviderError;
}

/** True when the abort was caused by an `AbortSignal.timeout(...)` source. */
export function isTimeoutReason(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    (reason as { name?: unknown }).name === "TimeoutError"
  );
}

/**
 * Converts an aborted signal into the error to throw: a timeout becomes a
 * typed `timeout` ProviderError; a caller cancellation re-throws the caller's
 * abort reason (an AbortError) so callers can tell "cancelled" from "failed".
 */
export function abortError(signal: AbortSignal, provider: ProviderId): unknown {
  const reason: unknown = signal.reason;
  if (isTimeoutReason(reason)) return new ProviderError({ kind: "timeout", provider });
  return reason ?? new DOMException("The operation was aborted.", "AbortError");
}

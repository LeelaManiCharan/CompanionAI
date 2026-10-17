/**
 * Pure provider selection for the Model_Router (Req 6.4, 6.5, 6.6, 6.20, 20.16).
 *
 * - `auto`: Ollama when its health check succeeded; otherwise Gemini when the
 *   server reports it available and the browser is online; otherwise `none`.
 * - `ollama`: always Ollama (never falls back to Gemini, 6.5).
 * - `gemini`: Gemini when available and online; otherwise `none` (never Ollama, 6.6).
 */
import type { ProviderMode } from "./models";

export type SelectedProvider = "ollama" | "gemini" | "none";

export function select(
  mode: ProviderMode,
  ollamaHealthy: boolean,
  geminiAvailable: boolean,
  online: boolean,
): SelectedProvider {
  const geminiUsable = geminiAvailable && online;
  switch (mode) {
    case "ollama":
      return "ollama";
    case "gemini":
      return geminiUsable ? "gemini" : "none";
    case "auto":
      if (ollamaHealthy) return "ollama";
      return geminiUsable ? "gemini" : "none";
  }
}

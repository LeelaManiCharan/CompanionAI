/**
 * Provider-agnostic generation request shape shared by the Context_Builder,
 * Model_Router, providers, and the Generate_Route (Req 6.1, 6A).
 *
 * This module is pure: types and constants only.
 */
import type { Role } from "./models";

export type Task = "reply" | "extract_memories" | "extract_reminder" | "summarize" | "test";

/** Tasks whose output must be a JSON object (JSON mime for Gemini, `format: "json"` for Ollama). */
export const JSON_TASKS: ReadonlySet<Task> = new Set<Task>(["extract_memories", "extract_reminder"]);
export type ProviderId = "ollama" | "gemini";

export interface GenerationMessage {
  role: Role;
  content: string;
}

export interface GenerationRequest {
  task: Task;
  system: string;
  messages: GenerationMessage[];
}

/** Max UTF-8 JSON size of a request body sent to the Generate_Route (6.24, 6A.2). */
export const MAX_REQUEST_BYTES = 65_536;

/**
 * Provider-agnostic generation request shape shared by the Context_Builder,
 * Model_Router, providers, and the Generate_Route (Req 6.1, 6A).
 *
 * This module is pure: types and constants only.
 */
import type { Role } from "./models";

export type Task = "reply" | "extract_memories" | "summarize" | "test";
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

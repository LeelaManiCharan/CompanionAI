/**
 * Context_Builder (Req 2.4, 9, 14.4, 15.1, 15.4, 20.22, 6.24).
 *
 * Assembles provider-agnostic generation requests. Because the request shape
 * has only `system` + `messages`, the "system prompt → Profile_Summary →
 * Memories → Messages" order of 9.1 is realized as fixed sections inside
 * `system`, followed by `messages`.
 *
 * This module is pure: no DOM, no IndexedDB, no network.
 */
import { MAX_REQUEST_BYTES, type GenerationRequest, type ProviderId, type Task } from "./generation";
import type { Memory, Message, Tone } from "./models";
import { MAX_EXTRACTED_MEMORIES } from "./memory";
import { normalizeForMatch } from "./safety";
import { sortMessages } from "./selectors";

/** Max Memories injected into a reply request (9.1). */
export const MEMORY_LIMIT = 10;
/** Max recent Messages sent with a reply request (9.1, 20.22). */
export const MESSAGE_LIMIT = 20;
/** Max Profile_Summary length (9.6). */
export const SUMMARY_MAX_CHARS = 1_500;
/** Max content length of a single request message (Generate_Route schema). */
const MESSAGE_CONTENT_MAX = 10_000;

export const SUMMARY_HEADING = "## About the user";
export const MEMORIES_HEADING = "## Things you remember";

/** AI-boundary and wellbeing rules (15.1, 15.4). */
export const RULES_TEXT = [
  "Rules:",
  "- You are an AI, not a human. Never claim to be human or a real person in any reply.",
  "- You are not a therapist, doctor, or any kind of medical professional.",
  "- Never give medical or psychological diagnoses.",
  "- If asked whether you are human, a real person, a therapist, or a medical professional, say clearly that you are an AI and not a human or a therapist.",
  "- Encourage the user's real-world relationships and activities. Never present yourself as a replacement for the people in their life.",
  "- Keep replies short and warm, like a friend checking in.",
].join("\n");

/** Added when the Safety_Monitor flags the latest user Message (14.4). */
export const SAFETY_INSTRUCTION = [
  "Safety:",
  "The user's latest message may contain crisis or self-harm language.",
  "Respond with care and support. Do not give any instructions, methods, or details related to self-harm.",
  "Gently encourage them to reach out now: call or text 988 for the 988 Suicide and Crisis Lifeline, or call 911 if they are in immediate danger.",
].join("\n");

export interface ContextInput {
  task: Task;
  /** Active_Profile id; Memories of any other profile are dropped (9.4). */
  profileId: string;
  botName: string;
  tone: Tone;
  summary: string | null;
  memories: readonly Memory[];
  /** Messages of the current Chat (including the latest user Message), any order. */
  chatMessages: readonly Message[];
  latestUserText: string;
  safetyFlagged: boolean;
  provider: ProviderId;
}

const ms = (t: string): number => Date.parse(t);

const tokenize = (text: string): Set<string> => {
  const norm = normalizeForMatch(text);
  return new Set(norm.length > 0 ? norm.split(" ") : []);
};

/**
 * Ranks memories by relevance to `query` (9.1, 9.2): the number of distinct
 * normalized query tokens that also appear in the memory content, descending;
 * ties by `updatedAt` descending, then `id` ascending. The top
 * `min(limit, n)` are returned regardless of score. Input is not mutated.
 */
export function rankMemories(memories: readonly Memory[], query: string, limit = MEMORY_LIMIT): Memory[] {
  const queryTokens = tokenize(query);
  return memories
    .map((m) => {
      let score = 0;
      for (const t of tokenize(m.content)) if (queryTokens.has(t)) score++;
      return { m, score };
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        ms(b.m.updatedAt) - ms(a.m.updatedAt) ||
        (a.m.id < b.m.id ? -1 : a.m.id > b.m.id ? 1 : 0),
    )
    .slice(0, Math.max(0, limit))
    .map(({ m }) => m);
}

/** Persona block with the Bot_Name and Tone inserted verbatim (2.4). */
export const personaText = (botName: string, tone: Tone): string =>
  `You are ${botName}, a friendly AI companion who checks in on the user. Your tone is ${tone}.`;

const memoryLine = (m: Memory): string => `- [${m.category}] ${m.content}`;

/**
 * Builds the system prompt in fixed order: persona, rules, optional safety
 * instruction, `## About the user` (omitted if the summary is empty), and
 * `## Things you remember` (omitted if there are no memories).
 */
export function buildSystem(
  botName: string,
  tone: Tone,
  summary: string | null,
  memories: readonly Memory[],
  safetyFlagged: boolean,
): string {
  const sections = [personaText(botName, tone), RULES_TEXT];
  if (safetyFlagged) sections.push(SAFETY_INSTRUCTION);
  const trimmedSummary = summary?.trim() ?? "";
  if (trimmedSummary.length > 0) sections.push(`${SUMMARY_HEADING}\n${trimmedSummary}`);
  if (memories.length > 0) sections.push(`${MEMORIES_HEADING}\n${memories.map(memoryLine).join("\n")}`);
  return sections.join("\n\n");
}

/**
 * Assembles a reply-style generation request (9.1–9.4, 2.4, 14.4, 15.1, 15.4,
 * 20.22). Messages are the 20 most recent by `createdAt`, oldest first. For
 * gemini the request is trimmed to the 64 KB budget (6.24).
 */
export function buildContext(input: ContextInput): GenerationRequest {
  const ownMemories = input.memories.filter((m) => m.profileId === input.profileId);
  const ranked = rankMemories(ownMemories, input.latestUserText, MEMORY_LIMIT);
  const sorted = sortMessages(input.chatMessages);
  const recent = sorted.slice(Math.max(0, sorted.length - MESSAGE_LIMIT));

  const req: GenerationRequest = {
    task: input.task,
    system: buildSystem(input.botName, input.tone, input.summary, ranked, input.safetyFlagged),
    messages: recent.map((m) => ({ role: m.role, content: m.content })),
  };
  return input.provider === "gemini" ? trimToByteBudget(req, MAX_REQUEST_BYTES) : req;
}

const encoder = new TextEncoder();

/** UTF-8 byte length of the JSON body for `req`. */
export const requestBytes = (req: GenerationRequest): number => encoder.encode(JSON.stringify(req)).length;

/**
 * Removes Messages from the front (oldest) until the UTF-8 JSON body is at most
 * `maxBytes` (6.24). `system` is never changed and the final Message is never
 * removed, so the result may still exceed the budget if those alone do. A
 * request already within budget is returned unchanged (same reference).
 */
export function trimToByteBudget(req: GenerationRequest, maxBytes = MAX_REQUEST_BYTES): GenerationRequest {
  if (requestBytes(req) <= maxBytes) return req;
  let start = 0;
  let next: GenerationRequest = req;
  while (start < req.messages.length - 1) {
    start++;
    next = { ...req, messages: req.messages.slice(start) };
    if (requestBytes(next) <= maxBytes) break;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Memory extraction and Profile_Summary prompts (8.1, 9.5, 9.6)
// ---------------------------------------------------------------------------

export const EXTRACTION_SYSTEM = [
  "You extract long-term memories about the user from a short conversation excerpt.",
  `Return only JSON of the form {"memories":[{"category":"fact","content":"..."}]} with at most ${MAX_EXTRACTED_MEMORIES} items.`,
  'Each "category" must be one of: fact, mood, event, person.',
  'Each "content" is one short sentence about the user, 1 to 500 characters.',
  "Only include things the user said about themselves or people in their life. Do not include anything the companion said about itself.",
  'If there is nothing worth remembering, return {"memories":[]}.',
].join("\n");

export interface ExtractionInput {
  userText: string;
  /** The companion Message immediately before the user Message, if any. */
  previousCompanionText?: string | null;
}

const clip = (text: string, max = MESSAGE_CONTENT_MAX): string => (text.length > max ? text.slice(0, max) : text);

/** Builds an `extract_memories` request from the user Message and the preceding companion Message. */
export function buildExtractionRequest(input: ExtractionInput): GenerationRequest {
  const messages: GenerationRequest["messages"] = [];
  const prev = input.previousCompanionText?.trim();
  if (prev) messages.push({ role: "companion", content: clip(prev) });
  messages.push({ role: "user", content: clip(input.userText) });
  return { task: "extract_memories", system: EXTRACTION_SYSTEM, messages };
}

export const SUMMARY_SYSTEM = [
  "You write a short profile summary of the user from a list of things remembered about them.",
  `Write plain text of at most ${SUMMARY_MAX_CHARS} characters, in the third person, with no headings or lists.`,
  "Focus on stable facts, important people, ongoing events, and recent mood. Do not add anything that is not in the list.",
  "Do not include medical or psychological diagnoses.",
].join("\n");

const NO_MEMORIES_TEXT = "(No memories yet.)";

/**
 * Builds a `summarize` request from the profile's Memories (9.5). Memories of
 * other profiles are dropped; the most recently updated are listed first and
 * the list is cut to fit one request message.
 */
export function buildSummaryRequest(memories: readonly Memory[], profileId: string): GenerationRequest {
  const own = memories
    .filter((m) => m.profileId === profileId)
    .sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const header = "Things remembered about the user:";
  let content = header;
  for (const m of own) {
    const line = `\n${memoryLine(m)}`;
    if (content.length + line.length > MESSAGE_CONTENT_MAX) break;
    content += line;
  }
  if (content === header) content = NO_MEMORIES_TEXT;
  return { task: "summarize", system: SUMMARY_SYSTEM, messages: [{ role: "user", content }] };
}

/** Enforces the 1,500-character Profile_Summary limit on model output (9.6). */
export const truncateSummary = (text: string): string => text.trim().slice(0, SUMMARY_MAX_CHARS);

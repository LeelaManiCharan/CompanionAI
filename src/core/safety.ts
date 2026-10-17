/**
 * Safety_Monitor (Req 14). Pure, synchronous, and local: no network access
 * (Req 14.6). `normalizeForMatch` is also used for voice echo detection
 * (Req 20.31).
 */

/** Apostrophe-like characters that are dropped (not spaced) so "don't" → "dont". */
const APOSTROPHES = /['\u2018\u2019\u02BC\uFF07`]/gu;
/** Any Unicode punctuation or symbol becomes a word boundary. */
const PUNCT_OR_SYMBOL = /[\p{P}\p{S}]/gu;
const WHITESPACE_RUN = /\s+/gu;

/**
 * NFKC, lowercase, drop apostrophes, punctuation/symbols → space,
 * collapse whitespace, trim.
 */
export function normalizeForMatch(text: string): string {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFKC")
    .replace(APOSTROPHES, "")
    .replace(PUNCT_OR_SYMBOL, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim();
}

/**
 * Curated phrases indicating clear suicide or self-harm intent. Kept narrow on
 * purpose to limit false positives on ordinary sadness or figures of speech.
 */
const RAW_CRISIS_PHRASES: readonly string[] = [
  "suicide",
  "suicidal",
  "kill myself",
  "killing myself",
  "end my life",
  "ending my life",
  "take my own life",
  "taking my own life",
  "want to die",
  "wanna die",
  "want to be dead",
  "wish i was dead",
  "wish i were dead",
  "better off dead",
  "no reason to live",
  "don't want to live",
  "don't want to be alive",
  "hurt myself",
  "hurting myself",
  "harm myself",
  "harming myself",
  "self-harm",
  "self harm",
  "cut myself",
  "cutting myself",
];

/** Phrase list normalized once at module load with the same function as input. */
export const CRISIS_PHRASES: readonly string[] = Object.freeze(
  Array.from(new Set(RAW_CRISIS_PHRASES.map(normalizeForMatch).filter((p) => p.length > 0))),
);

export interface CrisisResult {
  flagged: boolean;
  matched: string[];
}

/** Whole-word phrase match on normalized text (Req 14.1). */
export function detectCrisis(text: string): CrisisResult {
  const padded = ` ${normalizeForMatch(text)} `;
  const matched = CRISIS_PHRASES.filter((phrase) => padded.includes(` ${phrase} `));
  return { flagged: matched.length > 0, matched };
}

/** Spoken before any Companion reply when a voice message is flagged (Req 14.3). */
export const VOICE_CRISIS_LINE =
  "I'm really glad you told me, and I care about how you're doing. You don't have to go through this alone. " +
  "You can call or text 988 to reach the 988 Suicide and Crisis Lifeline any time. " +
  "If you are in immediate danger, please call 911.";

/** Shown in place of the Companion reply when a flagged message's generation fails (Req 14.8). */
export const CRISIS_FALLBACK_REPLY =
  "I'm having trouble responding right now, but what you shared matters. " +
  "Please reach out to the 988 Suicide and Crisis Lifeline by calling or texting 988. " +
  "If you are in immediate danger, call 911.";

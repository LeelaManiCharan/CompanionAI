/**
 * Input validators for user-entered values. Each validator normalizes its input
 * (trimming where the requirements say so) and returns either the value to
 * store or a fixed, user-facing error message. Pure: no DOM, no IndexedDB.
 *
 * Lengths are UTF-16 code units (`string.length`), matching `models.ts`.
 */
import {
  BUCKET_NAME_REGEX,
  DEFAULT_BUCKET_NAME,
  HHMM_REGEX,
  isAbsoluteUrl,
  type ProviderMode,
  type Settings,
  type Tone,
} from "./models";

// ---------------------------------------------------------------------------
// Defaults (2.3, 6.2, 6.3, 18.1)
// ---------------------------------------------------------------------------

export const DEFAULT_BOT_NAME = "Sunny";
export const DEFAULT_TONE: Tone = "calm";
export const DEFAULT_PROVIDER_MODE: ProviderMode = "auto";
export const DEFAULT_OLLAMA_BASE_URL = "http://localhost:11434";
export const DEFAULT_OLLAMA_MODEL = "llama3.1:8b";
export { DEFAULT_BUCKET_NAME };

/** Settings for a newly created Profile. Tracking and notifications start off (opt-in). */
export const defaultSettings = (profileId: string, now: string): Settings => ({
  profileId,
  botName: DEFAULT_BOT_NAME,
  tone: DEFAULT_TONE,
  providerMode: DEFAULT_PROVIDER_MODE,
  ollamaBaseUrl: DEFAULT_OLLAMA_BASE_URL,
  ollamaModel: DEFAULT_OLLAMA_MODEL,
  geminiNoticeAcknowledgedAt: null,
  activityTrackingEnabled: false,
  notificationsEnabled: false,
  checkInTimeOverride: null,
  updatedAt: now,
});

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type ValidationResult<T = string> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const fail = (error: string): ValidationResult<never> => ({ ok: false, error });

const lengthBetween = (v: string, min: number, max: number) => v.length >= min && v.length <= max;

// ---------------------------------------------------------------------------
// Limits and messages
// ---------------------------------------------------------------------------

export const LIMITS = {
  displayName: { min: 1, max: 40 },
  botName: { min: 1, max: 30 },
  messageText: { min: 1, max: 4_000 },
  ollamaModel: { min: 1, max: 100 },
  url: { min: 1, max: 2_048 },
  apiKey: { min: 1, max: 256 },
  passphrase: { min: 8, max: 128 },
  memoryContent: { min: 1, max: 500 },
  summary: { min: 0, max: 1_500 },
} as const;

export const ERRORS = {
  displayName: "Display name must be 1 to 40 characters.",
  botName: "Bot name must be 1 to 30 characters.",
  messageText: "Message must be 1 to 4,000 characters and not only spaces.",
  ollamaBaseUrl: "Ollama base URL must be an absolute http or https URL of up to 2,048 characters.",
  ollamaModel: "Ollama model name must be 1 to 100 characters.",
  apiKey: "Key format is invalid: it must be 1 to 256 characters with no spaces.",
  checkInTime: "Check-in time must be in 24-hour HH:MM format, from 00:00 to 23:59.",
  passphrase: "Passphrase must be 8 to 128 characters.",
  supabaseUrl: "Supabase URL must be an absolute https URL of up to 2,048 characters.",
  bucketName: "Bucket name must be 1 to 63 lowercase letters, digits, or hyphens.",
  memoryContent: "Memory must be 1 to 500 characters.",
  summary: "Summary must be at most 1,500 characters.",
} as const;

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

/** 1.1, 1.7: trimmed, 1–40. */
export function validateDisplayName(input: string): ValidationResult {
  const v = input.trim();
  return lengthBetween(v, LIMITS.displayName.min, LIMITS.displayName.max) ? ok(v) : fail(ERRORS.displayName);
}

/** 2.1, 2.6: trimmed, 1–30. */
export function validateBotName(input: string): ValidationResult {
  const v = input.trim();
  return lengthBetween(v, LIMITS.botName.min, LIMITS.botName.max) ? ok(v) : fail(ERRORS.botName);
}

/**
 * 4.1, 4.6: 1–4,000 characters with at least one non-whitespace character.
 * The text is stored as typed (not trimmed).
 */
export function validateMessageText(input: string): ValidationResult {
  if (!lengthBetween(input, LIMITS.messageText.min, LIMITS.messageText.max)) return fail(ERRORS.messageText);
  if (input.trim().length === 0) return fail(ERRORS.messageText);
  return ok(input);
}

/** 6.3, 6.14: trimmed absolute http(s) URL, 1–2,048. */
export function validateOllamaBaseUrl(input: string): ValidationResult {
  const v = input.trim();
  return isAbsoluteUrl(v, ["http:", "https:"]) ? ok(v) : fail(ERRORS.ollamaBaseUrl);
}

/** 6.3, 6.14: trimmed, 1–100. */
export function validateOllamaModel(input: string): ValidationResult {
  const v = input.trim();
  return lengthBetween(v, LIMITS.ollamaModel.min, LIMITS.ollamaModel.max) ? ok(v) : fail(ERRORS.ollamaModel);
}

/** 7.5, 7.6: trimmed, 1–256, no internal whitespace. */
export function validateApiKey(input: string): ValidationResult {
  const v = input.trim();
  if (!lengthBetween(v, LIMITS.apiKey.min, LIMITS.apiKey.max)) return fail(ERRORS.apiKey);
  if (/\s/.test(v)) return fail(ERRORS.apiKey);
  return ok(v);
}

/** 12.4, 12.5: trimmed `HH:MM`, 00:00–23:59. */
export function validateCheckInTime(input: string): ValidationResult {
  const v = input.trim();
  return HHMM_REGEX.test(v) ? ok(v) : fail(ERRORS.checkInTime);
}

/** 18.16: 8–128 characters, used exactly as entered (never trimmed). */
export function validatePassphrase(input: string): ValidationResult {
  return lengthBetween(input, LIMITS.passphrase.min, LIMITS.passphrase.max) ? ok(input) : fail(ERRORS.passphrase);
}

/** 18.1: trimmed absolute https URL, 1–2,048. */
export function validateSupabaseUrl(input: string): ValidationResult {
  const v = input.trim();
  return isAbsoluteUrl(v, ["https:"]) ? ok(v) : fail(ERRORS.supabaseUrl);
}

/** 18.1: trimmed, 1–63 of `[a-z0-9-]`. */
export function validateBucketName(input: string): ValidationResult {
  const v = input.trim();
  return BUCKET_NAME_REGEX.test(v) ? ok(v) : fail(ERRORS.bucketName);
}

/** 8.7, 19.5: trimmed, 1–500. */
export function validateMemoryContent(input: string): ValidationResult {
  const v = input.trim();
  return lengthBetween(v, LIMITS.memoryContent.min, LIMITS.memoryContent.max) ? ok(v) : fail(ERRORS.memoryContent);
}

/** 9.8, 19.7: trimmed, 0–1,500 (an empty summary is allowed). */
export function validateSummary(input: string): ValidationResult {
  const v = input.trim();
  return v.length <= LIMITS.summary.max ? ok(v) : fail(ERRORS.summary);
}

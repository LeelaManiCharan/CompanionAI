/**
 * Reminder detection and parsing (Req 24.1, 24.2).
 *
 * `mightBeReminder` is a cheap pre-filter so the `extract_reminder` request
 * only runs for messages that look like a reminder request. The model returns
 * a local wall-clock time, which is resolved to a UTC instant here (DST-safe
 * via `resolveLocalTime`), so the model never does time-zone math.
 *
 * This module is pure: no DOM, no IndexedDB, no network.
 */
import type { GenerationRequest } from "./generation";
import { HHMM_REGEX, LocalDate, REMINDER_TEXT_MAX } from "./models";
import { localDate, localDateTime, resolveLocalTime } from "./schedule";

/** Reminders further ahead than this are rejected (24.2). */
export const REMINDER_MAX_AHEAD_MS = 30 * 86_400_000;
/** A pending reminder due longer ago than this is closed without ringing (24.5). */
export const REMINDER_STALE_MS = 6 * 3_600_000;
/** Max time spent on extraction before the reply proceeds without it (24.1). */
export const REMINDER_EXTRACT_TIMEOUT_MS = 8_000;

const PREFILTER =
  /\b(?:remind|call me|ring me|ping me|wake me|alarm)|\bat\s+\d|\bin\s+(?:an?|\d+)\s*(?:min|hour|hr)/i;

/** True when `text` plausibly asks for a reminder, so extraction is worth running (24.1). */
export function mightBeReminder(text: string): boolean {
  return PREFILTER.test(text);
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function weekdayOf(date: string): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return WEEKDAYS[day] ?? "";
}

export const REMINDER_SYSTEM = [
  "You detect whether the user is asking to be reminded or called about something at a specific time.",
  'Return only JSON of the form {"reminder":{"text":"...","due_local":"YYYY-MM-DDTHH:MM"}} or {"reminder":null}.',
  '"text" is a short reminder phrase in the second person without the time, e.g. "watch the movie". At most 200 characters.',
  '"due_local" is the local date and 24-hour time the reminder should ring, in the user\'s time zone.',
  "Resolve relative times from the current local date-time below:",
  '- "in 10 minutes" / "in an hour": add to the current local time.',
  '- "at 7:32" with no date: the next occurrence of that time (today if still ahead, otherwise tomorrow).',
  "- No am/pm and the hour is 1-12: pick whichever of the am or pm time comes next.",
  '- "tomorrow", weekdays, and dates: use that day.',
  'If the user does not ask for a reminder or call, or gives no time at all, return {"reminder":null}.',
].join("\n");

export interface ReminderRequestInput {
  userText: string;
  /** Current instant, UTC ISO. */
  nowIso: string;
  /** IANA time zone of the user. */
  timeZone: string;
  /** Current local date-time `YYYY-MM-DDTHH:MM`; derived from `nowIso` when omitted. */
  localNow?: string;
  /** The companion Message just before the user Message (e.g. "What time?"), if any. */
  previousCompanionText?: string | null;
}

const MESSAGE_CONTENT_MAX = 10_000;
const clip = (t: string) => (t.length > MESSAGE_CONTENT_MAX ? t.slice(0, MESSAGE_CONTENT_MAX) : t);

/** Builds an `extract_reminder` request (24.1). */
export function buildReminderRequest(input: ReminderRequestInput): GenerationRequest {
  const localNow = input.localNow ?? localDateTime(input.nowIso, input.timeZone);
  const system = [
    REMINDER_SYSTEM,
    "",
    `Current local date-time: ${localNow} (${weekdayOf(localNow.slice(0, 10))})`,
    `Time zone: ${input.timeZone}`,
    `Current UTC instant: ${input.nowIso}`,
  ].join("\n");
  const messages: GenerationRequest["messages"] = [];
  const prev = input.previousCompanionText?.trim();
  if (prev) messages.push({ role: "companion", content: clip(prev) });
  messages.push({ role: "user", content: clip(input.userText) });
  return { task: "extract_reminder", system, messages };
}

export interface ParsedReminder {
  text: string;
  /** UTC ISO instant with millisecond precision. */
  dueAt: string;
}

/** Pulls the first JSON object out of model output (tolerates code fences and prose). */
function jsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return undefined;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

const DUE_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2})?$/;

/**
 * Parses `extract_reminder` output into a reminder, or null (24.2). The text
 * is trimmed and cut to 200 characters; the due time is resolved in
 * `timeZone` and must be after `nowMs` and at most 30 days ahead.
 */
export function parseReminder(raw: string, timeZone: string, nowMs: number): ParsedReminder | null {
  const obj = jsonObject(raw);
  if (typeof obj !== "object" || obj === null) return null;
  const rem = (obj as { reminder?: unknown }).reminder;
  if (typeof rem !== "object" || rem === null) return null;
  const { text, due_local } = rem as { text?: unknown; due_local?: unknown };
  if (typeof text !== "string" || typeof due_local !== "string") return null;

  const cleaned = text.trim().replace(/\s+/g, " ").slice(0, REMINDER_TEXT_MAX).trim();
  if (cleaned.length === 0) return null;

  const m = DUE_RE.exec(due_local.trim());
  if (!m) return null;
  const [, date, hhmm] = m as unknown as [string, string, string];
  if (!LocalDate.safeParse(date).success || !HHMM_REGEX.test(hhmm)) return null;

  let dueAt: string;
  try {
    dueAt = resolveLocalTime(date, hhmm, timeZone);
  } catch {
    return null;
  }
  const dueMs = Date.parse(dueAt);
  if (!(dueMs > nowMs) || dueMs - nowMs > REMINDER_MAX_AHEAD_MS) return null;
  return { text: cleaned, dueAt };
}

/** "today at 19:32", "tomorrow at 07:05", or "on 2025-03-04 at 08:00" in `timeZone` (24.3). */
export function describeDue(dueAt: string, timeZone: string, nowMs: number): string {
  const local = localDateTime(dueAt, timeZone);
  const date = local.slice(0, 10);
  const time = local.slice(11);
  const today = localDate(new Date(nowMs).toISOString(), timeZone);
  const tomorrow = localDate(new Date(Date.parse(resolveLocalTime(today, "12:00", timeZone)) + 86_400_000).toISOString(), timeZone);
  if (date === today) return `today at ${time}`;
  if (date === tomorrow) return `tomorrow at ${time}`;
  return `on ${weekdayOf(date)} ${date} at ${time}`;
}

/**
 * Pure scheduling helpers for the Activity_Tracker and Check_In_Scheduler.
 *
 * Every function takes an explicit `now` / instant and an IANA `timeZone`, and
 * uses only `Intl.DateTimeFormat` for zone math, so tests can exercise DST
 * zones deterministically. Requirements: 12.1, 12.3, 12.4, 12.6–12.10, 13.5,
 * 15.5, 15.8, 20.11–20.15.
 */
import type { ActivityLog, CheckIn } from "@/core/models";

/** Fallback Preferred_Check_In_Time (12.3). */
export const DEFAULT_PREFERRED_TIME = "19:00";
/** Snooze delay (12.7, 13.5). */
export const SNOOZE_MINUTES = 30;
export const SNOOZE_MS = SNOOZE_MINUTES * 60_000;
/** Minimum distinct local dates before activity drives the preferred time (12.1). */
export const MIN_DISTINCT_DATES = 3;
/** Window of most recent distinct local dates considered (12.1). */
export const RECENT_DATES_WINDOW = 14;

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

// ---------------------------------------------------------------------------
// Zone primitives
// ---------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      era: "short",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

interface WallParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallParts(ms: number, timeZone: string): WallParts {
  const out: WallParts = { year: 0, month: 0, day: 0, hour: 0, minute: 0, second: 0 };
  let bc = false;
  for (const p of formatterFor(timeZone).formatToParts(new Date(ms))) {
    switch (p.type) {
      case "year":
        out.year = Number(p.value);
        break;
      case "month":
        out.month = Number(p.value);
        break;
      case "day":
        out.day = Number(p.value);
        break;
      case "hour":
        out.hour = Number(p.value) % 24;
        break;
      case "minute":
        out.minute = Number(p.value);
        break;
      case "second":
        out.second = Number(p.value);
        break;
      case "era":
        bc = p.value.startsWith("B");
        break;
    }
  }
  if (bc) out.year = 1 - out.year;
  return out;
}

/** Local wall-clock time of `ms` in `timeZone`, expressed as "UTC-epoch ms of that wall time". */
function wallMs(ms: number, timeZone: string): number {
  const p = wallParts(ms, timeZone);
  const d = new Date(0);
  d.setUTCFullYear(p.year, p.month - 1, p.day);
  d.setUTCHours(p.hour, p.minute, p.second, 0);
  // Intl drops milliseconds; add them back so wallMs(t) - t is the exact offset.
  return d.getTime() + (((ms % 1000) + 1000) % 1000);
}

/** UTC offset (ms) of `timeZone` at instant `ms`. */
function offsetAt(ms: number, timeZone: string): number {
  return wallMs(ms, timeZone) - ms;
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

function parseInstant(instant: string): number {
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) throw new RangeError(`Invalid instant: ${instant}`);
  return ms;
}

/** Parses `YYYY-MM-DD` + `HH:MM` as a wall time in "UTC-epoch ms" form. */
function wallFromDateTime(date: string, hhmm: string): number {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!dm || !tm) throw new RangeError(`Invalid date/time: ${date} ${hhmm}`);
  const d = new Date(0);
  d.setUTCFullYear(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
  d.setUTCHours(Number(tm[1]), Number(tm[2]), 0, 0);
  return d.getTime();
}

function dateOfWall(wall: number): string {
  const d = new Date(wall);
  return `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(date: string, days: number): string {
  return dateOfWall(wallFromDateTime(date, "00:00") + days * DAY_MS);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Local calendar date (`YYYY-MM-DD`) of a UTC instant in `timeZone`. */
export function localDate(instant: string, timeZone: string): string {
  const p = wallParts(parseInstant(instant), timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
}

/** Local wall-clock date-time `YYYY-MM-DDTHH:MM` of a UTC instant in `timeZone` (24.1). */
export function localDateTime(instant: string, timeZone: string): string {
  const p = wallParts(parseInstant(instant), timeZone);
  return `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

function localHour(ms: number, timeZone: string): number {
  return wallParts(ms, timeZone).hour;
}

/**
 * Preferred_Check_In_Time as `HH:MM` (12.1, 12.3, 12.4).
 * Override wins; otherwise needs tracking enabled and logs on ≥ 3 distinct
 * local dates. Uses the 14 most recent distinct local dates, picks the local
 * hour with the most session starts, ties → hour of the most recent start.
 */
export function computePreferredTime(
  logs: readonly ActivityLog[],
  trackingEnabled: boolean,
  override: string | null,
  timeZone: string,
): string {
  if (override !== null) return override;
  if (!trackingEnabled) return DEFAULT_PREFERRED_TIME;

  const starts = logs.map((l) => {
    const ms = parseInstant(l.startedAt);
    return { ms, date: localDate(l.startedAt, timeZone) };
  });
  const dates = [...new Set(starts.map((s) => s.date))].sort().reverse();
  if (dates.length < MIN_DISTINCT_DATES) return DEFAULT_PREFERRED_TIME;

  const recent = new Set(dates.slice(0, RECENT_DATES_WINDOW));
  const count = new Array<number>(24).fill(0);
  const latest = new Array<number>(24).fill(-Infinity);
  for (const s of starts) {
    if (!recent.has(s.date)) continue;
    const h = localHour(s.ms, timeZone);
    count[h] = (count[h] ?? 0) + 1;
    latest[h] = Math.max(latest[h] ?? -Infinity, s.ms);
  }

  let best = -1;
  for (let h = 0; h < 24; h++) {
    const c = count[h] ?? 0;
    if (c === 0) continue;
    if (
      best === -1 ||
      c > (count[best] ?? 0) ||
      (c === (count[best] ?? 0) && (latest[h] ?? -Infinity) > (latest[best] ?? -Infinity))
    ) {
      best = h;
    }
  }
  return best === -1 ? DEFAULT_PREFERRED_TIME : `${pad(best)}:00`;
}

/**
 * Resolves local `date` + `hhmm` in `timeZone` to a UTC instant (ISO string).
 * Returns the earliest instant on that local date whose wall time is ≥ `hhmm`:
 * repeated times (DST overlap) → first occurrence; skipped times (DST gap) →
 * first valid instant after (20.12).
 */
export function resolveLocalTime(date: string, hhmm: string, timeZone: string): string {
  const wall = wallFromDateTime(date, hhmm);

  // Offsets in effect around the target; transitions within ±1 day are covered.
  const offsets = new Set<number>([offsetAt(wall - DAY_MS, timeZone), offsetAt(wall + DAY_MS, timeZone)]);
  for (const o of [...offsets]) offsets.add(offsetAt(wall - o, timeZone));

  let exact = Infinity;
  for (const o of offsets) {
    const t = wall - o;
    if (wallMs(t, timeZone) === wall) exact = Math.min(exact, t);
  }
  if (exact !== Infinity) return new Date(exact).toISOString();

  // Gap: wall time jumps over `wall`. Find the first instant whose wall time ≥ `wall`.
  const os = [...offsets];
  let lo = wall - Math.max(...os) - HOUR_MS; // wall time < target here
  let hi = wall - Math.min(...os) + HOUR_MS; // wall time > target here
  while (wallMs(lo, timeZone) >= wall) lo -= HOUR_MS;
  while (wallMs(hi, timeZone) < wall) hi += HOUR_MS;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (wallMs(mid, timeZone) >= wall) hi = mid;
    else lo = mid;
  }
  return new Date(hi).toISOString();
}

export interface ScheduleState {
  /** Current instant (UTC ISO). */
  now: string;
  timeZone: string;
  /** Preferred_Check_In_Time `HH:MM` currently in effect. */
  preferredTime: string;
  /**
   * The stored CheckIn for the Active_Profile on the current local date, or
   * null. Records for any other date are ignored (20.13, 20.15).
   */
  today: CheckIn | null;
  /** True on the first evaluation after the app opens (12.10). */
  appOpening: boolean;
}

export type ScheduleAction = "none" | "trigger" | "snooze_reminder" | "prompt_on_open";

/**
 * Decides the scheduler action for the current local date only (12.6–12.10,
 * 13.5, 20.11–20.15). A stored CheckIn record means the date was already
 * triggered (prompt-on-open counts), so at most one trigger per date; a
 * snooze reminder fires once, at/after `snoozedUntil`, on the same date.
 */
export function evaluateSchedule(s: ScheduleState): ScheduleAction {
  const nowMs = parseInstant(s.now);
  const today = localDate(s.now, s.timeZone);
  const record = s.today !== null && s.today.date === today ? s.today : null;

  if (record === null) {
    const due = parseInstant(resolveLocalTime(today, s.preferredTime, s.timeZone));
    if (nowMs < due) return "none";
    return s.appOpening ? "prompt_on_open" : "trigger";
  }

  if (record.completedAt !== null) return "none";
  if (record.snoozedUntil === null || record.snoozeFiredAt !== null) return "none";
  if (parseInstant(record.snoozedUntil) > nowMs) return "none";
  if (localDate(record.snoozedUntil, s.timeZone) !== today) return "none";
  return "snooze_reminder";
}

/** True if the Daily_Check_In for this record may still be snoozed (one per date, 13.5). */
export function canSnooze(record: CheckIn | null): boolean {
  return record !== null && record.completedAt === null && record.snoozedUntil === null;
}

/** `snoozedUntil` for a snooze selected at `now` (12.7, 13.5). */
export function snoozeUntil(now: string): string {
  return new Date(parseInstant(now) + SNOOZE_MS).toISOString();
}

/**
 * Seconds of activity on the local calendar date of `now` (15.5, 15.8).
 * Each session (and the in-progress one, ending at `now`) contributes only its
 * overlap with the local day `[00:00, next 00:00)`.
 */
export function activeSecondsOnDate(
  logs: readonly ActivityLog[],
  inProgress: { startedAt: string } | null,
  now: string,
  timeZone: string,
): number {
  const nowMs = parseInstant(now);
  const today = localDate(now, timeZone);
  const dayStart = parseInstant(resolveLocalTime(today, "00:00", timeZone));
  const dayEnd = parseInstant(resolveLocalTime(addDays(today, 1), "00:00", timeZone));

  const intervals: Array<[number, number]> = logs.map((l) => [parseInstant(l.startedAt), parseInstant(l.endedAt)]);
  if (inProgress) intervals.push([parseInstant(inProgress.startedAt), nowMs]);

  let total = 0;
  for (const [start, end] of intervals) {
    const overlap = Math.min(end, dayEnd) - Math.max(start, dayStart);
    if (overlap > 0) total += overlap;
  }
  return Math.floor(Math.min(total, dayEnd - dayStart) / 1000);
}

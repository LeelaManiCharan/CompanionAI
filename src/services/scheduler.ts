/**
 * Check_In_Scheduler (Req 12.6–12.10, 13.3, 13.5, 20.1, 20.11–20.15).
 *
 * - A 15 s ticker runs in every tab, but only the leader tab evaluates and
 *   triggers (20.1).
 * - Each tick compares the local date, UTC offset and time zone with the last
 *   tick (20.11). A wall-clock jump over 45 s, or `visibilitychange → visible`,
 *   is treated as a resume and evaluated immediately (20.14).
 * - Only today's CheckIn record is evaluated (20.13, 20.15). A trigger or snooze
 *   reminder is written to IndexedDB before the prompt/notification is emitted,
 *   so a reload cannot double-trigger (12.8).
 *
 * Browser-only; importing during SSR is safe and `startScheduler()` is a no-op there.
 */
import type { CheckIn } from "@/core/models";
import { canSnooze, computePreferredTime, evaluateSchedule, localDate, snoozeUntil, type ScheduleAction } from "@/core/schedule";
import { getRepo, initRepo, subscribeRepo, type ChangeEvent, type Repo } from "@/data/repository";
import { currentTimeZone } from "./activityTracker";
import { showCheckIn } from "./notifications";
import { getActiveProfileId, opFor, subscribeSession } from "./session";
import { isLeader, onReloadAll, subscribeLeader } from "./tabCoordinator";
import type { ServiceResult } from "./profileService";

export type { ServiceResult };

export const TICK_MS = 15_000;
/** A gap between ticks this much longer than `TICK_MS` counts as a resume (20.14). */
export const RESUME_JUMP_MS = 45_000;
/** Evaluations within this window after start count as "app opening" (12.10). */
const OPEN_WINDOW_MS = 60_000;
const NOTIFICATION_BODY = "Got a minute to check in? I'd love to hear how your day is going.";

export const SCHEDULER_ERRORS = {
  noProfile: "No Profile is selected.",
  unavailable: "Local storage is unavailable, so the check-in was not snoozed.",
  cannotSnooze: "This check-in can't be snoozed again today.",
  notSaved: "The snooze was not saved.",
} as const;

export interface CheckInPrompt {
  profileId: string;
  /** Local calendar date of the Daily_Check_In (YYYY-MM-DD). */
  date: string;
  botName: string;
  /** False once the one snooze for this date has been used (13.5). */
  canSnooze: boolean;
}

export interface SchedulerState {
  prompt: CheckInPrompt | null;
}

const isBrowser = (): boolean => typeof window !== "undefined" && typeof document !== "undefined";
const nowIso = (): string => new Date().toISOString();

async function repo(): Promise<Repo | null> {
  try {
    return getRepo() ?? (await initRepo());
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let started = false;
let startedAtMs = 0;
let evaluatedOnce = false;
let timer: ReturnType<typeof setInterval> | null = null;
let lastTickMs: number | null = null;
let lastDate: string | null = null;
let lastOffset: number | null = null;
let lastTz: string | null = null;
let evaluating = false;
let rerun = false;
let lastProfileId: string | null = null;
let detachRepo: (() => void) | null = null;
const cleanups: Array<() => void> = [];

let state: SchedulerState = Object.freeze({ prompt: null });
const SERVER_STATE: SchedulerState = Object.freeze({ prompt: null });
const listeners = new Set<() => void>();

function setPrompt(prompt: CheckInPrompt | null): void {
  if (prompt === state.prompt) return;
  state = Object.freeze({ prompt });
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      // Listener errors must not break scheduling.
    }
  }
}

// ---------------------------------------------------------------------------
// Read helpers (Home_Page)
// ---------------------------------------------------------------------------

/** Preferred_Check_In_Time `HH:MM` for `profileId`: override, activity, or 19:00 (12.1, 12.3, 12.4). */
export async function getPreferredTime(profileId: string, timeZone = currentTimeZone()): Promise<string> {
  const r = await repo();
  if (!r) return computePreferredTime([], false, null, timeZone);
  const [settings, logs] = await Promise.all([r.getSettings(profileId), r.activityByProfile(profileId)]);
  return computePreferredTime(
    logs,
    settings?.activityTrackingEnabled === true,
    settings?.checkInTimeOverride ?? null,
    timeZone,
  );
}

/** Today's CheckIn record (local date at the moment of the call), or null (20.13). */
export async function getTodayCheckIn(profileId: string, timeZone = currentTimeZone()): Promise<CheckIn | null> {
  const r = await repo();
  if (!r) return null;
  return (await r.getCheckIn(profileId, localDate(nowIso(), timeZone))) ?? null;
}

// ---------------------------------------------------------------------------
// Evaluation
// ---------------------------------------------------------------------------

/** Writes the trigger / snooze reminder; returns the stored record, or null if nothing was due anymore. */
async function persistAction(
  r: Repo,
  profileId: string,
  date: string,
  action: Exclude<ScheduleAction, "none">,
  now: string,
): Promise<CheckIn | null> {
  const res = await r.tx(opFor(profileId), ["checkIns"], async (t) => {
    const cur = await t.get("checkIns", [profileId, date]);
    let next: CheckIn;
    if (action === "snooze_reminder") {
      if (!cur || cur.completedAt !== null || cur.snoozedUntil === null || cur.snoozeFiredAt !== null) return null;
      if (Date.parse(cur.snoozedUntil) > Date.parse(now)) return null;
      next = { ...cur, snoozeFiredAt: now };
    } else {
      // Another tab (a previous leader) may have triggered already (12.8).
      if (cur) return null;
      next = { profileId, date, triggeredAt: now, snoozedUntil: null, completedAt: null, snoozeFiredAt: null };
    }
    await t.put("checkIns", next);
    return next;
  });
  return res.ok ? res.value : null;
}

async function evaluateOnce(): Promise<void> {
  if (!isLeader()) return;
  const profileId = getActiveProfileId();
  if (!profileId) return;
  const r = await repo();
  if (!r || r.mode !== "ready") return;

  const timeZone = currentTimeZone();
  const now = nowIso();
  const date = localDate(now, timeZone);

  const [settings, logs, record] = await Promise.all([
    r.getSettings(profileId),
    r.activityByProfile(profileId),
    r.getCheckIn(profileId, date),
  ]);
  if (!settings || getActiveProfileId() !== profileId) return;
  const today = record ?? null;

  // Completion (or a record for another date) cancels any shown prompt (12.9, 20.15).
  const p = state.prompt;
  if (p && (p.profileId !== profileId || p.date !== date || today?.completedAt)) setPrompt(null);

  const preferredTime = computePreferredTime(
    logs,
    settings.activityTrackingEnabled,
    settings.checkInTimeOverride,
    timeZone,
  );
  const appOpening = !evaluatedOnce && Date.now() - startedAtMs < OPEN_WINDOW_MS;
  evaluatedOnce = true;

  const action = evaluateSchedule({ now, timeZone, preferredTime, today, appOpening });
  if (action === "none") return;

  // Persist before emitting so a reload cannot double-trigger (12.8).
  const stored = await persistAction(r, profileId, date, action, now);
  if (!stored || !isLeader() || getActiveProfileId() !== profileId) return;

  const botName = settings.botName;
  setPrompt({ profileId, date, botName, canSnooze: canSnooze(stored) });

  if (action !== "prompt_on_open" && settings.notificationsEnabled) {
    void showCheckIn({ profileId, date, botName, body: NOTIFICATION_BODY }).catch(() => false);
  }
}

/** Runs an evaluation, coalescing concurrent requests into one follow-up run. */
async function evaluate(): Promise<void> {
  if (evaluating) {
    rerun = true;
    return;
  }
  evaluating = true;
  try {
    do {
      rerun = false;
      try {
        await evaluateOnce();
      } catch {
        // A failed read/write is retried on the next tick.
      }
    } while (rerun);
  } finally {
    evaluating = false;
  }
}

/** Compares date / offset / zone with the previous tick and detects resume (20.11, 20.14). */
function tick(): void {
  const nowMs = Date.now();
  const tz = currentTimeZone();
  const date = localDate(new Date(nowMs).toISOString(), tz);
  const offset = new Date(nowMs).getTimezoneOffset();

  const resumed = lastTickMs !== null && Math.abs(nowMs - lastTickMs - TICK_MS) > RESUME_JUMP_MS;
  const changed = date !== lastDate || offset !== lastOffset || tz !== lastTz;
  lastTickMs = nowMs;
  lastDate = date;
  lastOffset = offset;
  lastTz = tz;

  // A prompt for an earlier date is stale after a date change or resume (20.15).
  if ((changed || resumed) && state.prompt && state.prompt.date !== date) setPrompt(null);
  void evaluate();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") tick();
}

function onChange(event: ChangeEvent): void {
  if (event.profileId !== getActiveProfileId()) return;
  if (event.stores.some((s) => s === "checkIns" || s === "settings" || s === "activityLogs")) {
    // Re-evaluates the preferred time after new sessions (12.2) and clears
    // the prompt when the check-in is completed (12.9).
    void refreshPrompt().then(() => evaluate());
  }
}

/** Clears the prompt if today's record was completed or snoozed elsewhere. */
async function refreshPrompt(): Promise<void> {
  const p = state.prompt;
  if (!p) return;
  const r = await repo();
  if (!r) return;
  try {
    const rec = await r.getCheckIn(p.profileId, p.date);
    if (state.prompt !== p) return;
    if (!rec || rec.completedAt !== null) setPrompt(null);
    else if (rec.snoozedUntil !== null && rec.snoozeFiredAt === null) setPrompt(null);
    else if (p.canSnooze !== canSnooze(rec)) setPrompt({ ...p, canSnooze: canSnooze(rec) });
  } catch {
    // ignore; the next tick re-evaluates
  }
}

function attachRepo(): void {
  detachRepo?.();
  detachRepo = null;
  const r = getRepo();
  if (r) detachRepo = r.onChange(onChange);
}

function onSessionChange(): void {
  const pid = getActiveProfileId();
  if (pid === lastProfileId) return;
  lastProfileId = pid;
  if (state.prompt && state.prompt.profileId !== pid) setPrompt(null);
  void evaluate();
}

/** Starts the scheduler. Idempotent; no-op during SSR. */
export function startScheduler(): void {
  if (started || !isBrowser()) return;
  started = true;
  startedAtMs = Date.now();
  lastProfileId = getActiveProfileId();

  document.addEventListener("visibilitychange", onVisibilityChange);
  cleanups.push(
    subscribeSession(onSessionChange),
    subscribeLeader(() => {
      if (isLeader()) tick();
    }),
    // Remote ChangeEvents arrive through repo.onChange (TabSync → notifyExternalChange).
    subscribeRepo(attachRepo),
    onReloadAll(() => {
      setPrompt(null);
      void evaluate();
    }),
  );
  attachRepo();

  timer = setInterval(tick, TICK_MS);
  tick();
}

/** Stops timers and listeners (HMR / teardown). */
export function stopScheduler(): void {
  if (!started) return;
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  for (const c of cleanups.splice(0)) c();
  detachRepo?.();
  detachRepo = null;
  lastTickMs = null;
}

// ---------------------------------------------------------------------------
// User actions
// ---------------------------------------------------------------------------

/**
 * Snoozes today's Daily_Check_In for `profileId`: `snoozedUntil = now + 30 min`,
 * one snooze per date (12.7, 13.5). Cancels the current prompt.
 */
export async function snooze(profileId: string | null = getActiveProfileId()): Promise<ServiceResult<CheckIn>> {
  if (!profileId) return { ok: false, error: SCHEDULER_ERRORS.noProfile };
  const r = await repo();
  if (!r || r.mode !== "ready") return { ok: false, error: SCHEDULER_ERRORS.unavailable };

  const now = nowIso();
  const date = localDate(now, currentTimeZone());
  let refused = false;
  const res = await r.tx(opFor(profileId), ["checkIns"], async (t) => {
    const cur = (await t.get("checkIns", [profileId, date])) ?? null;
    if (!cur || !canSnooze(cur)) {
      refused = true;
      return null;
    }
    const next: CheckIn = { ...cur, snoozedUntil: snoozeUntil(now) };
    await t.put("checkIns", next);
    return next;
  });
  if (refused) return { ok: false, error: SCHEDULER_ERRORS.cannotSnooze };
  if (!res.ok || !res.value) return { ok: false, error: SCHEDULER_ERRORS.notSaved };

  const p = state.prompt;
  if (p && p.profileId === profileId) setPrompt(null);
  return { ok: true, value: res.value };
}

/** Hides the in-app prompt. The check-in stays triggered for today (12.8). */
export function dismissPrompt(): void {
  setPrompt(null);
}

// ---------------------------------------------------------------------------
// UI subscription
// ---------------------------------------------------------------------------

export function getSchedulerState(): SchedulerState {
  return state;
}

export function getServerSchedulerState(): SchedulerState {
  return SERVER_STATE;
}

/** For `useSyncExternalStore(subscribeScheduler, getSchedulerState, getServerSchedulerState)`. */
export function subscribeScheduler(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

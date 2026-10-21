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
import type { CheckIn, Reminder } from "@/core/models";
import { REMINDER_STALE_MS } from "@/core/reminders";
import { canSnooze, computePreferredTime, evaluateSchedule, localDate, snoozeUntil, type ScheduleAction } from "@/core/schedule";
import { getRepo, initRepo, subscribeRepo, type ChangeEvent, type Repo } from "@/data/repository";
import { currentTimeZone } from "./activityTracker";
import { showCheckIn, showReminder } from "./notifications";
import { getActiveProfileId, opFor, subscribeSession } from "./session";
import { isLeader, onReloadAll, subscribeLeader } from "./tabCoordinator";
import { startRingtone, stopRingtone } from "./ringtone";
import type { ServiceResult } from "./profileService";

export type { ServiceResult };

export const TICK_MS = 15_000;
/** A gap between ticks this much longer than `TICK_MS` counts as a resume (20.14). */
export const RESUME_JUMP_MS = 45_000;
/** Evaluations within this window after start count as "app opening" (12.10). */
const OPEN_WINDOW_MS = 60_000;
const NOTIFICATION_BODY = "Got a minute to check in? I'd love to hear how your day is going.";
/** A reminder fired (by any tab) this recently still shows its banner here. */
const FIRED_SHOW_MS = 10 * 60_000;
/** An evaluation stuck longer than this no longer blocks new ones. */
const EVALUATION_STUCK_MS = 30_000;
/** Precise reminder timers fire this long after `dueAt` so `dueAt <= now` holds. */
const REMINDER_TIMER_SLACK_MS = 250;
/** Upper bound for one reminder timer; it re-arms after every evaluation. */
const REMINDER_TIMER_MAX_MS = 6 * 3_600_000;

export const SCHEDULER_ERRORS = {
  noProfile: "No Profile is selected.",
  unavailable: "Local storage is unavailable, so the check-in was not snoozed.",
  cannotSnooze: "This check-in can't be snoozed again today.",
  notSaved: "The snooze was not saved.",
} as const;

export interface CheckInPrompt {
  kind: "checkin";
  profileId: string;
  /** Local calendar date of the Daily_Check_In (YYYY-MM-DD). */
  date: string;
  botName: string;
  /** False once the one snooze for this date has been used (13.5). */
  canSnooze: boolean;
}

/** A fired Reminder "calling" the user (24.6). */
export interface ReminderPrompt {
  kind: "reminder";
  profileId: string;
  botName: string;
  reminderId: string;
  text: string;
}

export type SchedulerPrompt = CheckInPrompt | ReminderPrompt;

export interface SchedulerState {
  prompt: SchedulerPrompt | null;
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
let evaluatingSinceMs = 0;
let rerun = false;
let lastProfileId: string | null = null;
let detachRepo: (() => void) | null = null;
let reminderTimer: ReturnType<typeof setTimeout> | null = null;
let armSeq = 0;
/** Reminder ids whose banner was answered/dismissed in this tab. */
const handledReminders = new Set<string>();
const cleanups: Array<() => void> = [];

let state: SchedulerState = Object.freeze({ prompt: null });
const SERVER_STATE: SchedulerState = Object.freeze({ prompt: null });
const listeners = new Set<() => void>();

/**
 * Sets the in-app prompt. `ring` starts the ringtone (leader tab, fresh
 * trigger only); clearing the prompt or switching Profile stops it.
 */
function setPrompt(prompt: SchedulerPrompt | null, ring = false): void {
  // An evaluation still in flight after stop (sign-out) must not show anything.
  if (prompt && !started) return;
  if (!prompt || (state.prompt && state.prompt.profileId !== prompt.profileId)) stopRingtone();
  if (prompt && ring) startRingtone();
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

/**
 * Rings due Reminders of the Active_Profile (24.5, 24.6). Each status change
 * is persisted before the prompt/notification, so a reload cannot ring twice;
 * reminders due more than 6 h ago are closed silently.
 */
async function fireReminders(r: Repo, profileId: string, botName: string, notify: boolean): Promise<void> {
  const nowMs = Date.now();
  const due = (await r.remindersByProfile(profileId)).filter(
    (x) => x.status === "pending" && Date.parse(x.dueAt) <= nowMs,
  );
  for (const rem of due) {
    const stale = nowMs - Date.parse(rem.dueAt) > REMINDER_STALE_MS;
    const now = new Date(nowMs).toISOString();
    const res = await r.tx(opFor(profileId), ["reminders"], async (t) => {
      const cur = await t.get("reminders", rem.id);
      // Another tab (a previous leader) may have handled it already.
      if (!cur || cur.status !== "pending") return null;
      const next: Reminder = stale ? { ...cur, status: "done" } : { ...cur, status: "fired", firedAt: now };
      await t.put("reminders", next);
      return next;
    });
    const stored = res.ok ? res.value : null;
    if (!stored || stale) continue;
    if (getActiveProfileId() !== profileId) return;

    // Persisted as fired: show and ring here even if leadership just moved,
    // so the ring is never lost between the write and the prompt.
    setPrompt({ kind: "reminder", profileId, botName, reminderId: stored.id, text: stored.text }, true);
    if (notify) {
      void showReminder({ reminderId: stored.id, botName, text: stored.text }).catch(() => false);
    }
  }
}

/**
 * Shows the banner for a reminder that is ringing (status "fired", fired in
 * the last few minutes) but has no prompt in this tab: a non-leader tab, or
 * the leader after a reload. Never rings; only the firing tab does.
 */
async function showFiredReminder(r: Repo, profileId: string, botName: string): Promise<void> {
  if (state.prompt) return;
  const nowMs = Date.now();
  const ringingNow = (await r.remindersByProfile(profileId)).filter(
    (x) =>
      x.status === "fired" &&
      x.firedAt !== null &&
      nowMs - Date.parse(x.firedAt) <= FIRED_SHOW_MS &&
      !handledReminders.has(x.id),
  );
  const latest = ringingNow.at(-1);
  if (!latest || state.prompt || getActiveProfileId() !== profileId) return;
  setPrompt({ kind: "reminder", profileId, botName, reminderId: latest.id, text: latest.text });
}

async function evaluateOnce(): Promise<void> {
  const profileId = getActiveProfileId();
  if (!profileId) return;
  const r = await repo();
  if (!r || r.mode !== "ready") return;

  // Settings alone are enough for reminders; read them first so a failing
  // activity/check-in read can never block a reminder from ringing.
  const settings = await r.getSettings(profileId);
  if (!settings || getActiveProfileId() !== profileId) return;

  if (isLeader()) {
    // A failed reminder read/write must not block the check-in; it is retried next tick.
    await fireReminders(r, profileId, settings.botName, settings.notificationsEnabled).catch(() => undefined);
  }
  await showFiredReminder(r, profileId, settings.botName).catch(() => undefined);
  if (!isLeader() || getActiveProfileId() !== profileId) return;

  const timeZone = currentTimeZone();
  const now = nowIso();
  const date = localDate(now, timeZone);
  const [logs, record] = await Promise.all([r.activityByProfile(profileId), r.getCheckIn(profileId, date)]);
  if (!isLeader() || getActiveProfileId() !== profileId) return;
  const today = record ?? null;

  // Completion (or a record for another date) cancels any shown prompt (12.9, 20.15).
  const p = state.prompt;
  if (p && p.profileId !== profileId) setPrompt(null);
  else if (p?.kind === "checkin" && (p.date !== date || today?.completedAt)) setPrompt(null);

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
  // A ringing reminder keeps the banner; the check-in notification still shows.
  // A due trigger or snooze reminder rings; a missed check-in shown on opening doesn't.
  if (state.prompt?.kind !== "reminder") {
    setPrompt(
      { kind: "checkin", profileId, date, botName, canSnooze: canSnooze(stored) },
      action !== "prompt_on_open",
    );
  }

  if (action !== "prompt_on_open" && settings.notificationsEnabled) {
    void showCheckIn({ profileId, date, botName, body: NOTIFICATION_BODY }).catch(() => false);
  }
}

/** Runs an evaluation, coalescing concurrent requests into one follow-up run. */
async function evaluate(): Promise<void> {
  if (!started) return;
  // A hung IndexedDB request must not wedge the scheduler forever.
  if (evaluating && Date.now() - evaluatingSinceMs < EVALUATION_STUCK_MS) {
    rerun = true;
    return;
  }
  evaluating = true;
  const since = Date.now();
  evaluatingSinceMs = since;
  try {
    do {
      rerun = false;
      try {
        await evaluateOnce();
      } catch {
        // A failed read/write is retried on the next tick.
      }
    } while (rerun && started);
  } finally {
    if (evaluatingSinceMs === since) evaluating = false;
  }
  void armReminderTimer();
}

function clearReminderTimer(): void {
  if (reminderTimer) clearTimeout(reminderTimer);
  reminderTimer = null;
}

/**
 * Arms a one-shot timer for the earliest pending Reminder of the
 * Active_Profile, so it rings on time instead of up to one tick late (24.5).
 * Re-armed after every evaluation, on reminder changes and Profile switches.
 */
async function armReminderTimer(): Promise<void> {
  const seq = ++armSeq;
  const profileId = getActiveProfileId();
  const r = getRepo();
  // Only the leader rings; other tabs learn about it through change events.
  if (!started || !isLeader() || !profileId || !r || r.mode !== "ready") {
    clearReminderTimer();
    return;
  }
  let reminders: Reminder[];
  try {
    reminders = await r.remindersByProfile(profileId);
  } catch {
    return;
  }
  if (seq !== armSeq || !started) return;
  clearReminderTimer();
  let nextMs = Infinity;
  for (const x of reminders) {
    const due = Date.parse(x.dueAt);
    if (x.status === "pending" && Number.isFinite(due) && due < nextMs) nextMs = due;
  }
  // Already due but still pending: the evaluation that just ran failed to
  // fire it, so the 15 s tick retries (no tight retry loop).
  if (nextMs === Infinity || nextMs <= Date.now()) return;
  const delay = Math.min(nextMs - Date.now() + REMINDER_TIMER_SLACK_MS, REMINDER_TIMER_MAX_MS);
  reminderTimer = setTimeout(() => {
    reminderTimer = null;
    void evaluate();
  }, delay);
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
  if ((changed || resumed) && state.prompt?.kind === "checkin" && state.prompt.date !== date) setPrompt(null);
  void evaluate();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") tick();
}

function onChange(event: ChangeEvent): void {
  if (event.profileId !== getActiveProfileId()) return;
  if (event.stores.some((s) => s === "checkIns" || s === "settings" || s === "activityLogs" || s === "reminders")) {
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
  if (p.kind === "reminder") {
    // Answered, cancelled, or deleted elsewhere: stop ringing (24.6, 24.7).
    try {
      const all = await r.remindersByProfile(p.profileId);
      if (state.prompt !== p) return;
      if (all.find((x) => x.id === p.reminderId)?.status !== "fired") setPrompt(null);
    } catch {
      // ignore; the next change re-checks
    }
    return;
  }
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
  // A (re)opened Local_Store: evaluate against it right away.
  if (started && r) void evaluate();
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
  clearReminderTimer();
  armSeq++;
  // Reset so a later start (next sign-in, hot reload) begins fresh.
  lastTickMs = null;
  lastDate = null;
  lastOffset = null;
  lastTz = null;
  evaluatedOnce = false;
  evaluating = false;
  rerun = false;
  lastProfileId = null;
  handledReminders.clear();
  setPrompt(null);
}

// Dev hot reload re-executes this module. Without this, the replaced
// instance keeps ticking with its own prompt state that no component reads,
// so a reminder is marked fired but never shown. A globalThis slot (not
// `module.hot`, which breaks webpack's ESM handling) lets the new instance
// stop the previous one.
if (isBrowser()) {
  const g = globalThis as { __companionScheduler?: { stop(): void } };
  try {
    g.__companionScheduler?.stop();
  } catch {
    // A broken previous instance must not block this one.
  }
  g.__companionScheduler = { stop: stopScheduler };
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
  if (p?.kind === "checkin" && p.profileId === profileId) setPrompt(null);
  return { ok: true, value: res.value };
}

/** Hides the in-app prompt. The check-in stays triggered for today (12.8). */
export function dismissPrompt(): void {
  const p = state.prompt;
  if (p?.kind === "reminder") handledReminders.add(p.reminderId);
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

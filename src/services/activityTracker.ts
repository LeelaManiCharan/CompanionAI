/**
 * Activity_Tracker (Req 11.2, 11.3, 11.5, 11.8, 12.2, 15.5–15.8).
 *
 * - A session starts when the tab becomes visible (or at start if visible) and
 *   ends on `visibilitychange → hidden` or `pagehide`.
 * - An Activity_Log is written only if tracking was enabled for the Active_Profile
 *   for the whole session; disabling tracking or switching Profile drops the
 *   in-progress session (11.3).
 * - The break suggestion is checked every 15 s from today's logs plus the
 *   in-progress session, deferred while a call is active, and shown at most
 *   once per Profile per local date via `profileMeta.lastBreakSuggestionDate`.
 *
 * Browser-only; importing during SSR is safe and `startActivityTracker()` is a no-op there.
 */
import type { ActivityLog, ProfileMeta } from "@/core/models";
import { activeSecondsOnDate, localDate } from "@/core/schedule";
import { getRepo, initRepo, subscribeRepo, type ChangeEvent, type Repo } from "@/data/repository";
import { getActiveProfileId, opFor, subscribeSession } from "./session";
import { onReloadAll } from "./tabCoordinator";
import type { ServiceResult } from "./profileService";

export type { ServiceResult };

/** 2 hours (15.5). */
export const BREAK_THRESHOLD_SECONDS = 7200;
const CHECK_MS = 15_000;
const MAX_DURATION_SECONDS = 86_400;
const MAX_PAGE = 200;

export const ACTIVITY_ERRORS = {
  noProfile: "No Profile is selected, so activity was not changed.",
  unavailable: "Local storage is unavailable, so activity was not changed.",
  clearFailed: "Activity could not be cleared. Your activity history is unchanged.",
  saveFailed: "This session's activity could not be saved.",
} as const;

export interface BreakSuggestion {
  profileId: string;
  /** Local calendar date the suggestion was shown for (YYYY-MM-DD). */
  date: string;
}

export interface ActivityTrackerState {
  /** Break suggestion currently shown, or null (15.5). */
  breakSuggestion: BreakSuggestion | null;
  /** Last activity write error, or null (11.8). */
  error: string | null;
}

interface Session {
  profileId: string;
  startedAt: string;
  page: string;
}

const isBrowser = (): boolean => typeof window !== "undefined" && typeof document !== "undefined";
const nowIso = (): string => new Date().toISOString();

/** The browser's current IANA time zone (re-read each time; it can change at runtime). */
export function currentTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let started = false;
let session: Session | null = null;
/** Bumped whenever a pending session start must be abandoned. */
let startToken = 0;
let callActive = false;
let checking = false;
let timer: ReturnType<typeof setInterval> | null = null;
let detachRepo: (() => void) | null = null;
const cleanups: Array<() => void> = [];

let state: ActivityTrackerState = Object.freeze({ breakSuggestion: null, error: null });
const listeners = new Set<() => void>();

function setState(next: Partial<ActivityTrackerState>): void {
  const merged = { ...state, ...next };
  if (merged.breakSuggestion === state.breakSuggestion && merged.error === state.error) return;
  state = Object.freeze(merged);
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      // Listener errors must not break tracking.
    }
  }
}

async function repo(): Promise<Repo | null> {
  try {
    return getRepo() ?? (await initRepo());
  } catch {
    return null;
  }
}

async function trackingEnabled(profileId: string): Promise<boolean> {
  const r = await repo();
  if (!r) return false;
  try {
    const s = await r.getSettings(profileId);
    return s?.activityTrackingEnabled === true;
  } catch {
    return false;
  }
}

function currentPage(): string {
  const p = isBrowser() ? window.location.pathname : "/";
  return (p || "/").slice(0, MAX_PAGE);
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Drops the in-progress session without recording it (11.3). */
function dropSession(): void {
  startToken++;
  session = null;
}

/** Starts a session for the Active_Profile if the tab is visible and tracking is enabled. */
async function startSession(): Promise<void> {
  if (!isBrowser() || document.visibilityState !== "visible" || session) return;
  const profileId = getActiveProfileId();
  if (!profileId) return;
  const token = ++startToken;
  const startedAt = nowIso();
  const page = currentPage();
  const enabled = await trackingEnabled(profileId);
  if (token !== startToken || session || getActiveProfileId() !== profileId) return;
  if (!enabled || document.visibilityState !== "visible") return;
  session = { profileId, startedAt, page };
  void checkBreakSuggestion();
}

/** Ends the in-progress session and records it if tracking stayed enabled (11.2). */
async function endSession(): Promise<void> {
  const s = session;
  dropSession();
  if (!s) return;
  const endedAt = nowIso();

  // Re-check: tracking must still be enabled at the end of the session.
  if (getActiveProfileId() !== s.profileId || !(await trackingEnabled(s.profileId))) return;

  const endMs = Date.parse(endedAt);
  let startMs = Date.parse(s.startedAt);
  if (endMs < startMs) return; // clock moved backwards; the interval is meaningless
  if (endMs - startMs > MAX_DURATION_SECONDS * 1000) startMs = endMs - MAX_DURATION_SECONDS * 1000;
  const startedAt = new Date(startMs).toISOString();

  const log: ActivityLog = {
    id: crypto.randomUUID(),
    profileId: s.profileId,
    startedAt,
    endedAt,
    durationSeconds: Math.floor((endMs - startMs) / 1000),
    page: s.page,
  };

  const r = await repo();
  if (!r || r.mode !== "ready") {
    setState({ error: ACTIVITY_ERRORS.saveFailed });
    return;
  }
  const res = await r.tx(opFor(s.profileId), ["settings", "activityLogs"], async (t) => {
    // Final guard inside the write transaction (11.3).
    const settings = await t.get("settings", s.profileId);
    if (!settings?.activityTrackingEnabled) return false;
    await t.put("activityLogs", log);
    return true;
  });
  if (!res.ok && res.error.kind !== "stale") setState({ error: ACTIVITY_ERRORS.saveFailed });
}

/** Re-reads the tracking setting; drops the session if disabled, starts one if newly enabled. */
async function onSettingsChanged(profileId: string): Promise<void> {
  if (profileId !== getActiveProfileId()) return;
  const enabled = await trackingEnabled(profileId);
  if (profileId !== getActiveProfileId()) return;
  if (!enabled) {
    if (session?.profileId === profileId) dropSession();
    else startToken++; // abandon a pending start that read stale settings
    return;
  }
  if (!session) await startSession();
}

function onChange(event: ChangeEvent): void {
  if (event.stores.includes("settings")) void onSettingsChanged(event.profileId);
}

function attachRepo(): void {
  detachRepo?.();
  detachRepo = null;
  const r = getRepo();
  if (r) detachRepo = r.onChange(onChange);
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") void startSession();
  else void endSession();
}

function onPageHide(): void {
  void endSession();
}

function onPageShow(): void {
  void startSession();
}

let lastProfileId: string | null = null;
function onSessionChange(): void {
  const pid = getActiveProfileId();
  if (pid === lastProfileId) return;
  lastProfileId = pid;
  // Profile switch: the in-progress session is discarded (11.3) and any shown
  // break suggestion belongs to the previous Profile.
  dropSession();
  if (state.breakSuggestion && state.breakSuggestion.profileId !== pid) setState({ breakSuggestion: null });
  void startSession();
}

/** Starts the tracker. Idempotent; no-op during SSR. */
export function startActivityTracker(): void {
  if (started || !isBrowser()) return;
  started = true;
  lastProfileId = getActiveProfileId();

  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", onPageHide);
  window.addEventListener("pageshow", onPageShow);
  cleanups.push(
    subscribeSession(onSessionChange),
    // Remote ChangeEvents arrive through repo.onChange (TabSync → notifyExternalChange).
    subscribeRepo(attachRepo),
    onReloadAll(() => {
      dropSession();
      setState({ breakSuggestion: null });
      void startSession();
    }),
  );
  attachRepo();

  timer = setInterval(() => void checkBreakSuggestion(), CHECK_MS);
  void startSession();
}

// ---------------------------------------------------------------------------
// Clear activity (11.5, 11.8)
// ---------------------------------------------------------------------------

/** Deletes every Activity_Log of `profileId` in one transaction; other Profiles are untouched. */
export async function clearActivity(profileId: string | null = getActiveProfileId()): Promise<ServiceResult> {
  if (!profileId) return { ok: false, error: ACTIVITY_ERRORS.noProfile };
  const r = await repo();
  if (!r || r.mode !== "ready") return { ok: false, error: ACTIVITY_ERRORS.unavailable };
  const res = await r.tx(opFor(profileId), ["activityLogs"], async (t) => {
    const logs = await t.getAllByIndex("activityLogs", "byProfile", profileId);
    for (const l of logs) await t.delete("activityLogs", l.id);
  });
  if (!res.ok) return { ok: false, error: ACTIVITY_ERRORS.clearFailed };
  // The in-progress session started before the clear; restart it from now.
  if (session?.profileId === profileId) {
    dropSession();
    void startSession();
  }
  return { ok: true, value: undefined };
}

// ---------------------------------------------------------------------------
// Break suggestion (15.5–15.8)
// ---------------------------------------------------------------------------

/** Marks whether a voice call is active; ending a call re-checks a deferred suggestion (15.6). */
export function setCallActive(active: boolean): void {
  const was = callActive;
  callActive = active;
  if (was && !active) void checkBreakSuggestion();
}

export function isCallActive(): boolean {
  return callActive;
}

/**
 * Returns the suggestion to show for the Active_Profile now, or null: today's
 * activity exceeds 2 h, it was not shown today, and no call is active.
 */
export async function getBreakSuggestionDue(): Promise<BreakSuggestion | null> {
  if (callActive) return null;
  const profileId = getActiveProfileId();
  if (!profileId) return null;
  const r = await repo();
  if (!r) return null;
  const tz = currentTimeZone();
  const now = nowIso();
  const date = localDate(now, tz);
  try {
    const meta = await r.getProfileMeta(profileId);
    if (!meta || meta.lastBreakSuggestionDate === date) return null;
    const logs = await r.activityByProfile(profileId);
    const inProgress = session?.profileId === profileId ? { startedAt: session.startedAt } : null;
    const seconds = activeSecondsOnDate(logs, inProgress, now, tz);
    if (seconds <= BREAK_THRESHOLD_SECONDS) return null;
  } catch {
    return null;
  }
  if (callActive || getActiveProfileId() !== profileId) return null;
  return { profileId, date };
}

/** Persists that the suggestion was shown for `profileId` on `date` (15.7). Returns false if already shown or on failure. */
export async function markBreakSuggestionShown(profileId: string, date: string): Promise<boolean> {
  const r = await repo();
  if (!r || r.mode !== "ready") return false;
  const res = await r.tx(opFor(profileId), ["profileMeta"], async (t) => {
    const meta = await t.get("profileMeta", profileId);
    if (!meta || meta.lastBreakSuggestionDate === date) return false;
    const next: ProfileMeta = { ...meta, lastBreakSuggestionDate: date, updatedAt: nowIso() };
    await t.put("profileMeta", next);
    return true;
  });
  return res.ok && res.value;
}

async function checkBreakSuggestion(): Promise<void> {
  if (checking || state.breakSuggestion || callActive) return;
  checking = true;
  try {
    const due = await getBreakSuggestionDue();
    if (!due) return;
    // Persist first so another tab or a reload cannot show it again (15.7).
    if (!(await markBreakSuggestionShown(due.profileId, due.date))) return;
    if (getActiveProfileId() === due.profileId) setState({ breakSuggestion: due });
  } finally {
    checking = false;
  }
}

// ---------------------------------------------------------------------------
// UI subscription
// ---------------------------------------------------------------------------

export function getActivityTrackerState(): ActivityTrackerState {
  return state;
}

const SERVER_STATE: ActivityTrackerState = Object.freeze({ breakSuggestion: null, error: null });
export function getServerActivityTrackerState(): ActivityTrackerState {
  return SERVER_STATE;
}

/** For `useSyncExternalStore(subscribeActivityTracker, getActivityTrackerState, getServerActivityTrackerState)`. */
export function subscribeActivityTracker(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Hides the break suggestion toast (it stays marked as shown for today). */
export function dismissBreakSuggestion(): void {
  setState({ breakSuggestion: null });
}

export function clearActivityError(): void {
  setState({ error: null });
}

/** Stops listeners and timers (HMR / teardown). The in-progress session is dropped. */
export function stopActivityTracker(): void {
  if (!started) return;
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisibilityChange);
  window.removeEventListener("pagehide", onPageHide);
  window.removeEventListener("pageshow", onPageShow);
  for (const c of cleanups.splice(0)) c();
  detachRepo?.();
  detachRepo = null;
  dropSession();
}

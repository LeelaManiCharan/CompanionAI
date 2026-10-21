/**
 * Tab_Coordinator (Req 20.1–20.5, 20.29). Browser-only; every API is feature-detected
 * so importing this module during SSR is safe.
 *
 * - Leader election: Web Locks ("companion-leader") held for the tab's lifetime, or a
 *   BroadcastChannel heartbeat fallback (1 s beat, 3 s expiry, lowest tab id wins).
 * - Call exclusivity: Web Locks ("companion-call", ifAvailable) plus a "call-state"
 *   broadcast so other tabs can disable call controls.
 * - Data changes / restore: "companion-db" BroadcastChannel carrying ChangeEvents and
 *   "reload-all" notices.
 * - Every lock and channel name is suffixed with `:${userId}` (22.10).
 */
import type { ChangeEvent } from "@/data/repository";

const LEADER_LOCK = "companion-leader";
const CALL_LOCK = "companion-call";
const TABS_CHANNEL = "companion-tabs";
const DB_CHANNEL = "companion-db";

/**
 * Lock and channel names carry the signed-in user id (`companion-db:<id>`, …),
 * so tabs of different users on one browser never coordinate (22.10).
 */
let scope: string | null = null;
const scoped = (name: string): string => (scope ? `${name}:${scope}` : name);
const HEARTBEAT_MS = 1000;
const EXPIRY_MS = 3000;
/**
 * Presence window outside heartbeat mode. Background tabs' timers can be
 * throttled to once a minute, so a peer counts as present this long.
 */
const PRESENCE_MS = 65_000;
/** With no leader after this long and no other tab seen, this tab leads. */
const LEADER_FALLBACK_MS = 5000;

type TabsMessage =
  | { type: "heartbeat"; tabId: string }
  | { type: "bye"; tabId: string }
  | { type: "call-state"; tabId: string; active: boolean }
  | { type: "call-query"; tabId: string };

type DbMessage =
  | { type: "change"; from: string; event: ChangeEvent }
  | { type: "reload-all"; from: string; epoch?: number };

type Listener = () => void;

// ---------------------------------------------------------------------------
// Feature detection
// ---------------------------------------------------------------------------

const isBrowser = (): boolean => typeof window !== "undefined" && typeof navigator !== "undefined";

const locksSupported = (): boolean =>
  isBrowser() && "locks" in navigator && typeof navigator.locks?.request === "function";

const channelSupported = (): boolean => isBrowser() && typeof BroadcastChannel === "function";

function openChannel(name: string): BroadcastChannel | null {
  if (!channelSupported()) return null;
  try {
    return new BroadcastChannel(name);
  } catch {
    return null;
  }
}

function post(channel: BroadcastChannel | null, msg: unknown): void {
  if (!channel) return;
  try {
    channel.postMessage(msg);
  } catch {
    // Channel closed or message not cloneable; ignore.
  }
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** Time-prefixed so older tabs sort first (stable leadership in the heartbeat fallback). */
export const tabId: string = `${Date.now().toString(36).padStart(10, "0")}-${Math.random()
  .toString(36)
  .slice(2, 10)}`;

let started = false;
let startedAtMs = 0;
let leaderMode: "locks" | "heartbeat" | "solo" | null = null;
let leader = false;
let heartbeatReady = false;
let tabsChannel: BroadcastChannel | null = null;
let dbChannel: BroadcastChannel | null = null;
let timer: ReturnType<typeof setInterval> | null = null;

const peers = new Map<string, number>();
/** Other tabs currently in a call → last time we heard about it. */
const callHolders = new Map<string, number>();
let localCall = false;
let callElsewhere = false;

const leaderListeners = new Set<Listener>();
const callListeners = new Set<Listener>();
const changeListeners = new Set<(event: ChangeEvent) => void>();
const reloadListeners = new Set<(epoch?: number) => void>();

function emit(listeners: Set<Listener>): void {
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      // Listener errors must not break coordination.
    }
  }
}

function setLeader(value: boolean): void {
  if (leader === value) return;
  leader = value;
  emit(leaderListeners);
}

function recomputeCallElsewhere(): void {
  const value = callHolders.size > 0;
  if (value === callElsewhere) return;
  callElsewhere = value;
  emit(callListeners);
}

// ---------------------------------------------------------------------------
// Messaging
// ---------------------------------------------------------------------------

function onTabsMessage(ev: MessageEvent): void {
  const msg: unknown = ev.data;
  if (!isObject(msg) || typeof msg.tabId !== "string" || msg.tabId === tabId) return;
  const from = msg.tabId;
  const now = Date.now();
  switch (msg.type) {
    case "heartbeat":
      peers.set(from, now);
      break;
    case "bye":
      peers.delete(from);
      callHolders.delete(from);
      recomputeCallElsewhere();
      if (leaderMode === "heartbeat" && heartbeatReady) recomputeHeartbeatLeader();
      break;
    case "call-state":
      if (msg.active === true) callHolders.set(from, now);
      else callHolders.delete(from);
      recomputeCallElsewhere();
      break;
    case "call-query":
      if (localCall) post(tabsChannel, { type: "call-state", tabId, active: true } satisfies TabsMessage);
      break;
  }
}

function getDbChannel(): BroadcastChannel | null {
  // Opened only while started, so the name always includes the user id.
  if (dbChannel || !started || !channelSupported()) return dbChannel;
  dbChannel = openChannel(scoped(DB_CHANNEL));
  dbChannel?.addEventListener("message", (ev: MessageEvent) => {
    const msg: unknown = ev.data;
    if (!isObject(msg) || msg.from === tabId) return;
    if (msg.type === "change" && isObject(msg.event)) {
      const event = msg.event as unknown as ChangeEvent;
      for (const cb of [...changeListeners]) {
        try {
          cb(event);
        } catch {
          // ignore
        }
      }
    } else if (msg.type === "reload-all") {
      const epoch = typeof msg.epoch === "number" ? msg.epoch : undefined;
      for (const cb of [...reloadListeners]) {
        try {
          cb(epoch);
        } catch {
          // ignore
        }
      }
    }
  });
  return dbChannel;
}

// ---------------------------------------------------------------------------
// Leader election
// ---------------------------------------------------------------------------

function recomputeHeartbeatLeader(): void {
  let lowest = true;
  for (const id of peers.keys()) {
    if (id < tabId) {
      lowest = false;
      break;
    }
  }
  setLeader(lowest);
}

function startHeartbeatLeader(): void {
  if (!tabsChannel) {
    leaderMode = "solo";
    setLeader(true);
    return;
  }
  leaderMode = "heartbeat";
  post(tabsChannel, { type: "heartbeat", tabId } satisfies TabsMessage);
}

/** Releases (or abandons the wait for) the leader lock on stop. */
let leaderAbort: AbortController | null = null;
let releaseLeaderLock: (() => void) | null = null;

function startLocksLeader(): void {
  leaderMode = "locks";
  const abort = new AbortController();
  leaderAbort = abort;
  navigator.locks
    .request(scoped(LEADER_LOCK), { signal: abort.signal }, () => {
      if (abort.signal.aborted) return undefined;
      setLeader(true);
      // Held until this tab closes or the coordinator stops (sign-out).
      return new Promise<void>((resolve) => {
        releaseLeaderLock = resolve;
      });
    })
    .catch(() => {
      if (abort.signal.aborted) return;
      // Locks API present but unusable (e.g. insecure/opaque context).
      if (leaderMode === "locks" && !leader) startHeartbeatLeader();
    });
}

/** Periodic maintenance: heartbeats, peer/call expiry, call-state rebroadcast. */
function tick(): void {
  const now = Date.now();

  // Every tab announces itself (also in locks mode) so the fallback below
  // can tell whether any other tab exists.
  post(tabsChannel, { type: "heartbeat", tabId } satisfies TabsMessage);
  if (leaderMode === "heartbeat") {
    for (const [id, seen] of peers) if (now - seen > EXPIRY_MS) peers.delete(id);
    heartbeatReady = true;
    recomputeHeartbeatLeader();
  } else {
    for (const [id, seen] of peers) if (now - seen > PRESENCE_MS) peers.delete(id);
  }

  // Safety net: the leader lock never arrived (e.g. held by a stale module
  // instance after a hot reload, or a stuck request) and no other tab is
  // around, so nobody would ring. Lead from this tab.
  if (!leader && leaderMode === "locks" && now - startedAtMs >= LEADER_FALLBACK_MS && peers.size === 0) {
    setLeader(true);
  }

  if (localCall) post(tabsChannel, { type: "call-state", tabId, active: true } satisfies TabsMessage);

  if (callHolders.size > 0) {
    if (locksSupported() && typeof navigator.locks.query === "function") {
      // Timers are throttled in background tabs, so verify against the lock itself.
      navigator.locks
        .query()
        .then((snapshot) => {
          const held = (snapshot.held ?? []).some((l) => l.name === scoped(CALL_LOCK));
          if (!held && !localCall) {
            callHolders.clear();
            recomputeCallElsewhere();
          }
        })
        .catch(() => {});
    } else {
      for (const [id, seen] of callHolders) if (now - seen > EXPIRY_MS) callHolders.delete(id);
      recomputeCallElsewhere();
    }
  }
}

function onPageHide(): void {
  if (localCall) post(tabsChannel, { type: "call-state", tabId, active: false } satisfies TabsMessage);
  post(tabsChannel, { type: "bye", tabId } satisfies TabsMessage);
}

/**
 * Starts coordination for `userId` (lock/channel names get `:${userId}`).
 * Idempotent for the same user; a different user restarts it. No-op during SSR.
 */
export function startTabCoordinator(userId?: string): void {
  if (!isBrowser()) return;
  const nextScope = userId ?? null;
  if (started && nextScope === scope) return;
  if (started) stopTabCoordinator();
  scope = nextScope;
  started = true;
  startedAtMs = Date.now();

  tabsChannel = openChannel(scoped(TABS_CHANNEL));
  tabsChannel?.addEventListener("message", onTabsMessage);
  getDbChannel();

  if (locksSupported()) startLocksLeader();
  else startHeartbeatLeader();

  timer = setInterval(tick, HEARTBEAT_MS);
  window.addEventListener("pagehide", onPageHide);

  // Learn about calls already in progress in other tabs.
  post(tabsChannel, { type: "call-query", tabId } satisfies TabsMessage);
  post(tabsChannel, { type: "heartbeat", tabId } satisfies TabsMessage);
}

/** True once this tab has been elected leader (20.1). */
export function isLeader(): boolean {
  return leader;
}

export function subscribeLeader(cb: Listener): () => void {
  leaderListeners.add(cb);
  return () => {
    leaderListeners.delete(cb);
  };
}

// ---------------------------------------------------------------------------
// Call exclusivity (20.3)
// ---------------------------------------------------------------------------

/** True while another tab reports an active call. */
export function callInProgressElsewhere(): boolean {
  return callElsewhere;
}

export function subscribeCallElsewhere(cb: Listener): () => void {
  callListeners.add(cb);
  return () => {
    callListeners.delete(cb);
  };
}

function beginLocalCall(onRelease?: () => void): () => void {
  localCall = true;
  post(tabsChannel, { type: "call-state", tabId, active: true } satisfies TabsMessage);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    localCall = false;
    post(tabsChannel, { type: "call-state", tabId, active: false } satisfies TabsMessage);
    onRelease?.();
  };
}

/**
 * Tries to take the call lock without waiting. Resolves to a release function, or
 * `null` when another tab (or this tab) already has a call.
 */
export function acquireCallLock(): Promise<(() => void) | null> {
  if (!isBrowser() || localCall) return Promise.resolve(null);

  const fallback = (): (() => void) | null => (callElsewhere ? null : beginLocalCall());

  if (!locksSupported()) return Promise.resolve(fallback());

  return new Promise((resolve) => {
    navigator.locks
      .request(scoped(CALL_LOCK), { ifAvailable: true }, (lock) => {
        if (!lock) {
          resolve(null);
          return undefined;
        }
        return new Promise<void>((releaseLock) => {
          resolve(beginLocalCall(releaseLock));
        });
      })
      .catch(() => resolve(fallback()));
  });
}

// ---------------------------------------------------------------------------
// Data change propagation (20.4, 20.5) and restore (20.29)
// ---------------------------------------------------------------------------

/** Posts a committed ChangeEvent to other tabs. */
export function broadcastChange(event: ChangeEvent): void {
  post(getDbChannel(), { type: "change", from: tabId, event } satisfies DbMessage);
}

/** Subscribes to ChangeEvents committed in other tabs. */
export function onRemoteChange(cb: (event: ChangeEvent) => void): () => void {
  getDbChannel();
  changeListeners.add(cb);
  return () => {
    changeListeners.delete(cb);
  };
}

/** Tells other tabs to reload all state (after a restore bumps the epoch). */
export function broadcastReloadAll(epoch?: number): void {
  post(getDbChannel(), { type: "reload-all", from: tabId, epoch } satisfies DbMessage);
}

export function onReloadAll(cb: (epoch?: number) => void): () => void {
  getDbChannel();
  reloadListeners.add(cb);
  return () => {
    reloadListeners.delete(cb);
  };
}

/** Exposed for diagnostics. */
export function coordinatorMode(): typeof leaderMode {
  return leaderMode;
}

/**
 * Stops timers, releases the leader lock, and closes channels (HMR,
 * sign-out, user switch). Listeners are kept and reattach on the next start.
 */
export function stopTabCoordinator(): void {
  if (!started) return;
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
  if (isBrowser()) window.removeEventListener("pagehide", onPageHide);
  onPageHide();
  leaderAbort?.abort();
  leaderAbort = null;
  releaseLeaderLock?.();
  releaseLeaderLock = null;
  tabsChannel?.close();
  tabsChannel = null;
  dbChannel?.close();
  dbChannel = null;
  leaderMode = null;
  heartbeatReady = false;
  peers.clear();
  callHolders.clear();
  recomputeCallElsewhere();
  setLeader(false);
  scope = null;
}

// Dev hot reload re-executes this module. Without this, the replaced
// instance keeps the leader lock (and its timers) forever, so the new
// instance never becomes leader and nothing rings. A globalThis slot (not
// `module.hot`, which breaks webpack's ESM handling) lets the new instance
// stop the previous one.
if (isBrowser()) {
  const g = globalThis as { __companionTabCoordinator?: { stop(): void } };
  try {
    g.__companionTabCoordinator?.stop();
  } catch {
    // A broken previous instance must not block this one.
  }
  g.__companionTabCoordinator = { stop: stopTabCoordinator };
}

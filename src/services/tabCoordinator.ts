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
 */
import type { ChangeEvent } from "@/data/repository";

const LEADER_LOCK = "companion-leader";
const CALL_LOCK = "companion-call";
const TABS_CHANNEL = "companion-tabs";
const DB_CHANNEL = "companion-db";
const HEARTBEAT_MS = 1000;
const EXPIRY_MS = 3000;

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
  if (dbChannel || !channelSupported()) return dbChannel;
  dbChannel = openChannel(DB_CHANNEL);
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

function startLocksLeader(): void {
  leaderMode = "locks";
  navigator.locks
    .request(LEADER_LOCK, () => {
      setLeader(true);
      // Never resolves: the lock is held until this tab closes.
      return new Promise<never>(() => {});
    })
    .catch(() => {
      // Locks API present but unusable (e.g. insecure/opaque context).
      if (leaderMode === "locks" && !leader) startHeartbeatLeader();
    });
}

/** Periodic maintenance: heartbeats, peer/call expiry, call-state rebroadcast. */
function tick(): void {
  const now = Date.now();

  if (leaderMode === "heartbeat") {
    post(tabsChannel, { type: "heartbeat", tabId } satisfies TabsMessage);
    for (const [id, seen] of peers) if (now - seen > EXPIRY_MS) peers.delete(id);
    heartbeatReady = true;
    recomputeHeartbeatLeader();
  }

  if (localCall) post(tabsChannel, { type: "call-state", tabId, active: true } satisfies TabsMessage);

  if (callHolders.size > 0) {
    if (locksSupported() && typeof navigator.locks.query === "function") {
      // Timers are throttled in background tabs, so verify against the lock itself.
      navigator.locks
        .query()
        .then((snapshot) => {
          const held = (snapshot.held ?? []).some((l) => l.name === CALL_LOCK);
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

/** Starts coordination. Idempotent; no-op during SSR. */
export function startTabCoordinator(): void {
  if (started || !isBrowser()) return;
  started = true;

  tabsChannel = openChannel(TABS_CHANNEL);
  tabsChannel?.addEventListener("message", onTabsMessage);
  getDbChannel();

  if (locksSupported()) startLocksLeader();
  else startHeartbeatLeader();

  timer = setInterval(tick, HEARTBEAT_MS);
  window.addEventListener("pagehide", onPageHide);

  // Learn about calls already in progress in other tabs.
  post(tabsChannel, { type: "call-query", tabId } satisfies TabsMessage);
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
      .request(CALL_LOCK, { ifAvailable: true }, (lock) => {
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

/** Stops timers and closes channels (HMR / teardown). Listeners are kept. */
export function stopTabCoordinator(): void {
  if (!started) return;
  started = false;
  if (timer) clearInterval(timer);
  timer = null;
  if (isBrowser()) window.removeEventListener("pagehide", onPageHide);
  onPageHide();
  tabsChannel?.close();
  tabsChannel = null;
  dbChannel?.close();
  dbChannel = null;
  leaderMode = null;
  heartbeatReady = false;
  peers.clear();
}

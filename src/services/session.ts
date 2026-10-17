/**
 * Small client-side session store: the Active_Profile id and the restore epoch
 * the current operations should carry (1.3, 20.7, 20.29).
 *
 * Usable from React via `useSyncExternalStore(subscribeSession, getSession, getServerSession)`.
 * SSR-safe: pure module state, no browser APIs.
 */
import type { OperationContext } from "@/data/repository";

export interface SessionState {
  /** The Active_Profile, or `null` when no Profile is selected (or none exist). */
  readonly activeProfileId: string | null;
  /** Restore epoch last loaded from the browser record. */
  readonly epoch: number;
}

const INITIAL: SessionState = Object.freeze({ activeProfileId: null, epoch: 0 });

let state: SessionState = INITIAL;
const listeners = new Set<() => void>();

function update(next: Partial<SessionState>) {
  const merged: SessionState = { ...state, ...next };
  if (merged.activeProfileId === state.activeProfileId && merged.epoch === state.epoch) return;
  state = Object.freeze(merged);
  for (const l of [...listeners]) l();
}

/** Current snapshot (referentially stable until it changes). */
export function getSession(): SessionState {
  return state;
}

/** Snapshot used during server rendering. */
export function getServerSession(): SessionState {
  return INITIAL;
}

export function subscribeSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export function getActiveProfileId(): string | null {
  return state.activeProfileId;
}

export function setActiveProfileId(id: string | null): void {
  update({ activeProfileId: id });
}

export function getEpoch(): number {
  return state.epoch;
}

export function setEpoch(epoch: number): void {
  update({ epoch });
}

/** Operation context for the given Profile, captured now (20.7). */
export function opFor(profileId: string, chatId?: string): OperationContext {
  return chatId === undefined ? { profileId, epoch: state.epoch } : { profileId, chatId, epoch: state.epoch };
}

/** Resets to the initial state (e.g. after a full data reload). */
export function resetSession(): void {
  update(INITIAL);
}

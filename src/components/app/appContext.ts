"use client";

import { createContext, useContext } from "react";
import type { Profile, ProfileMeta, Settings } from "@/core/models";
import type { RepoMode } from "@/data/repository";

/** Browser storage notices raised at start and after each chat ends (20.19, 20.20). */
export interface StorageNotices {
  /** `navigator.storage.persist()` was denied and the notice was not dismissed. */
  persistDenied: boolean;
  /** Usage percentage when at or above 80% of quota, else null. */
  usagePercent: number | null;
  dismissPersist: () => void;
  dismissUsage: () => void;
}

export interface AppState {
  /** Local_Store mode; anything other than `ready` disables record-changing controls (16.7, 16.8). */
  repoMode: RepoMode;
  /** The Active_Profile, live from the Local_Store. Non-null for every page rendered under AppRoot. */
  activeProfile: Profile | null;
  /** Settings of the Active_Profile, live. */
  settings: Settings | null;
  /** Bookkeeping record of the Active_Profile (activity consent, summary state), live. */
  profileMeta: ProfileMeta | null;
  /** Re-runs startup profile selection and the Model_Router refresh. */
  refresh: () => Promise<void>;
  /** Re-reads storage usage; call after a Chat ends (20.20). */
  checkStorage: () => Promise<void>;
  storage: StorageNotices;
}

export const AppContext = createContext<AppState | null>(null);

/** Full app state. Throws outside `<AppRoot>`. */
export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used inside <AppRoot>");
  return ctx;
}

/** App state, or null outside `<AppRoot>` (for components that also render elsewhere). */
export function useOptionalApp(): AppState | null {
  return useContext(AppContext);
}

/**
 * The Active_Profile. Pages are only rendered by AppRoot once a Profile and its
 * Settings are loaded, so this is non-null there.
 */
export function useActiveProfile(): Profile {
  const { activeProfile } = useApp();
  if (!activeProfile) throw new Error("useActiveProfile requires an Active_Profile");
  return activeProfile;
}

/** Settings of the Active_Profile (non-null under AppRoot's ready state). */
export function useSettings(): Settings {
  const { settings } = useApp();
  if (!settings) throw new Error("useSettings requires loaded Settings");
  return settings;
}

export function useRepoMode(): RepoMode {
  return useApp().repoMode;
}

/** True when the Local_Store accepts writes; mutating controls should disable themselves otherwise. */
export function useCanWrite(): boolean {
  return useApp().repoMode === "ready";
}

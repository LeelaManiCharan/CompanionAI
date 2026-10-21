"use client";

import { useSyncExternalStore } from "react";
import { InlineAlert } from "@/components/ui";
import type { RepoMode } from "@/data/repository";
import {
  clearActivityError,
  getActivityTrackerState,
  getServerActivityTrackerState,
  subscribeActivityTracker,
} from "@/services/activityTracker";
import {
  dismissSyncFailed,
  getServerSyncFailed,
  getSyncFailed,
  subscribeSyncFailed,
} from "@/services/preferencesSync";
import { cn } from "@/lib/cn";
import { useOptionalApp } from "./appContext";

/** Local_Store mode banner (16.7, 16.8). Not dismissible: it stays for the session. */
export function RepoModeAlert({ mode, className }: { mode: RepoMode; className?: string }) {
  if (mode === "read_only") {
    return (
      <InlineAlert tone="danger" title="Your data could not be loaded" className={className}>
        Your saved data was left exactly as it was. To keep it safe, changes are turned off for this session. Try
        reloading the page or updating to the latest version of the app.
      </InlineAlert>
    );
  }
  if (mode === "unavailable") {
    return (
      <InlineAlert tone="danger" title="Local storage is unavailable" className={className}>
        This browser blocked or doesn&apos;t support local storage, so data will not be saved. Creating and editing
        are turned off. Private browsing or strict privacy settings are the usual cause.
      </InlineAlert>
    );
  }
  return null;
}

/**
 * App-level notices shown under the top bar: storage mode, persistence and
 * quota warnings (20.19, 20.20), activity write failures (11.8), and
 * Preferences_Sync failures (22.13).
 */
export function AppNotices({ className }: { className?: string }) {
  const app = useOptionalApp();
  const { error: activityError } = useSyncExternalStore(
    subscribeActivityTracker,
    getActivityTrackerState,
    getServerActivityTrackerState,
  );
  const prefsSyncFailed = useSyncExternalStore(subscribeSyncFailed, getSyncFailed, getServerSyncFailed);
  if (!app) return null;
  const { repoMode, storage } = app;

  const items = [
    repoMode !== "ready" ? <RepoModeAlert key="mode" mode={repoMode} /> : null,
    storage.usagePercent !== null ? (
      <InlineAlert
        key="usage"
        tone="warning"
        title={`Storage is ${storage.usagePercent}% full`}
        onDismiss={storage.dismissUsage}
      >
        Your browser is close to its storage limit for this app. Delete old chats, export your data, or back up to
        free space and keep your history safe.
      </InlineAlert>
    ) : null,
    storage.persistDenied ? (
      <InlineAlert key="persist" tone="info" title="Your browser may clear local data" onDismiss={storage.dismissPersist}>
        This browser didn&apos;t grant persistent storage, so it may clear data under storage pressure. A backup or
        export keeps your chats and memories safe.
      </InlineAlert>
    ) : null,
    activityError ? (
      <InlineAlert key="activity" tone="danger" title="Activity update failed" onDismiss={clearActivityError}>
        {activityError}
      </InlineAlert>
    ) : null,
    prefsSyncFailed ? (
      <InlineAlert key="prefs-sync" tone="info" title="Preferences not synced" onDismiss={dismissSyncFailed}>
        Your change is saved on this device but couldn&apos;t be synced to your account. It will sync on your next
        change or sign-in.
      </InlineAlert>
    ) : null,
  ].filter(Boolean);

  if (items.length === 0) return null;
  return <div className={cn("flex flex-col gap-2", className)}>{items}</div>;
}

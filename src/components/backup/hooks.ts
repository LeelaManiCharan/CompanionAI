"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import type { BackupMeta, BrowserRecord } from "@/core/models";
import { useLiveQuery, useRepo } from "@/data/useLiveQuery";
import {
  backupToCloud,
  type BackupServiceError,
  type CloudBackupResult,
  type RestoreResult,
} from "@/services/backupService";
import { getActiveCallChatId } from "@/services/chatService";
import { setEpoch } from "@/services/session";
import { broadcastReloadAll } from "@/services/tabCoordinator";
import { useCallElsewhere } from "@/services/useTabState";

// ---------------------------------------------------------------------------
// Connectivity (20.16, 20.18)
// ---------------------------------------------------------------------------

function subscribeOnline(cb: () => void): () => void {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

const getOnline = () => navigator.onLine !== false;
const getServerOnline = () => true;

/** Live `navigator.onLine`; re-renders immediately on `online` / `offline`. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnline, getServerOnline);
}

// ---------------------------------------------------------------------------
// Active call (20.28)
// ---------------------------------------------------------------------------

/** The call controller sets a plain module variable, so poll it once a second. */
function subscribeCallPoll(cb: () => void): () => void {
  const id = window.setInterval(cb, 1000);
  return () => window.clearInterval(id);
}

const getCallHere = () => getActiveCallChatId() !== null;
const getServerCall = () => false;

/** True while a voice call is active in this tab or another one. */
export function useCallActive(): boolean {
  const here = useSyncExternalStore(subscribeCallPoll, getCallHere, getServerCall);
  const elsewhere = useCallElsewhere();
  return here || elsewhere;
}

// ---------------------------------------------------------------------------
// Live records
// ---------------------------------------------------------------------------

/** The browser-level record (namespace id, Cloud_Store config); `undefined` while loading. */
export function useBrowserRecord(): { record: BrowserRecord | null | undefined; loading: boolean } {
  const repo = useRepo();
  const q = useLiveQuery<BrowserRecord | null>(
    async () => (repo ? ((await repo.getBrowserRecord()) ?? null) : null),
    ["browser"],
    [repo],
  );
  return { record: q.data, loading: q.loading && q.data === undefined };
}

/** Backup_Metadata, newest first. */
export function useBackupMeta(): BackupMeta[] {
  const repo = useRepo();
  const q = useLiveQuery<BackupMeta[]>(async () => (repo ? repo.listBackupMeta() : []), ["backupMeta"], [repo]);
  return q.data ?? [];
}

/** True when the Local_Store accepts writes. Works with or without an Active_Profile. */
export function useRepoWritable(): boolean {
  return useRepo()?.mode === "ready";
}

// ---------------------------------------------------------------------------
// Cloud config preflight (7.3, 18.4)
// ---------------------------------------------------------------------------

export type Preflight = { ok: true } | { ok: false; kind: "not_configured" | "no_key"; message: string };

export const PREFLIGHT_MESSAGES = {
  not_configured: "Cloud storage is not configured. Add your Supabase project URL, anon key, and bucket first.",
  no_key: "No Supabase anon key is saved. Enter your anon key in Cloud backup settings first.",
} as const;

/** Checks the saved config locally so an incomplete setup sends zero requests. */
export function preflightCloud(record: BrowserRecord | null | undefined): Preflight {
  const cfg = record?.cloudStoreConfig ?? null;
  if (!cfg || !cfg.supabaseUrl || !cfg.bucketName) {
    return { ok: false, kind: "not_configured", message: PREFLIGHT_MESSAGES.not_configured };
  }
  if (!cfg.supabaseAnonKey) return { ok: false, kind: "no_key", message: PREFLIGHT_MESSAGES.no_key };
  return { ok: true };
}

/** Error kinds whose fix lives in the Cloud backup settings. */
export const CONFIG_ERROR_KINDS: ReadonlySet<string> = new Set([
  "not_configured",
  "no_key",
  "key_rejected",
  "bucket_not_found",
]);

// ---------------------------------------------------------------------------
// Restore completion (20.29)
// ---------------------------------------------------------------------------

/**
 * After a restore or import replaced the Local_Store: publish the new epoch so
 * pending work is discarded, tell other tabs to reload, then reload this one.
 */
export function finishRestore(result: RestoreResult): void {
  setEpoch(result.epoch);
  broadcastReloadAll(result.epoch);
  window.location.assign("/");
}

// ---------------------------------------------------------------------------
// "Back up now" flow shared by BackupPanel and BackupCard
// ---------------------------------------------------------------------------

export interface BackupNowState {
  /** Passphrase dialog is open. */
  dialogOpen: boolean;
  busy: boolean;
  /** Error to show in the passphrase dialog (e.g. passphrase length). */
  dialogError: string | null;
  /** Last result shown next to the control. */
  outcome: { ok: true; value: CloudBackupResult } | { ok: false; error: BackupServiceError | Preflight } | null;
  /** Runs the local preflight, then opens the passphrase dialog. */
  start: () => void;
  submit: (passphrase: string) => Promise<void>;
  cancel: () => void;
  clearOutcome: () => void;
}

export function useBackupNow(record: BrowserRecord | null | undefined, onSuccess?: (r: CloudBackupResult) => void): BackupNowState {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<BackupNowState["outcome"]>(null);

  const start = useCallback(() => {
    const pre = preflightCloud(record);
    if (!pre.ok) {
      setOutcome({ ok: false, error: pre });
      return;
    }
    setOutcome(null);
    setDialogError(null);
    setDialogOpen(true);
  }, [record]);

  const submit = useCallback(
    async (passphrase: string) => {
      setBusy(true);
      setDialogError(null);
      const res = await backupToCloud(passphrase);
      setBusy(false);
      if (res.ok) {
        setDialogOpen(false);
        setOutcome({ ok: true, value: res.value });
        onSuccess?.(res.value);
        return;
      }
      if (res.error.kind === "passphrase_length") {
        setDialogError(res.error.message);
        return;
      }
      setDialogOpen(false);
      setOutcome({ ok: false, error: res.error });
    },
    [onSuccess],
  );

  const cancel = useCallback(() => {
    if (busy) return;
    setDialogOpen(false);
    setDialogError(null);
  }, [busy]);

  const clearOutcome = useCallback(() => setOutcome(null), []);

  return { dialogOpen, busy, dialogError, outcome, start, submit, cancel, clearOutcome };
}

/** Normalises a backup error or preflight failure to `{ kind, message }`. */
export function errorInfo(e: BackupServiceError | Preflight): { kind: string; message: string } {
  if ("ok" in e) return e.ok ? { kind: "", message: "" } : { kind: e.kind, message: e.message };
  return { kind: e.kind, message: e.message };
}

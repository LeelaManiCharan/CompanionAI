"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { Badge, Button, Dialog, Field, IconAlert, InlineAlert, Spinner, TextInput } from "@/components/ui";
import { validatePassphrase } from "@/core/validators";
import { cn } from "@/lib/cn";
import type { CloudBackupEntry } from "@/services/backupService";
import { formatBackupSize, formatBackupTime } from "./format";

const PASSPHRASE_HINT = "8 to 128 characters, used exactly as typed.";

// ---------------------------------------------------------------------------
// Passphrase (backup)
// ---------------------------------------------------------------------------

export type BackupPassphraseDialogProps = {
  open: boolean;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (passphrase: string) => void;
};

/**
 * Collects the Backup_Passphrase for an upload (18.2, 18.16). Mount it only
 * while open so the passphrase leaves memory when it closes (18.18).
 */
export function BackupPassphraseDialog({ open, busy, error, onCancel, onSubmit }: BackupPassphraseDialogProps) {
  const formId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pass, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [mismatch, setMismatch] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const v = validatePassphrase(pass);
    if (!v.ok) {
      setLocalError(v.error);
      return;
    }
    if (pass !== confirm) {
      setMismatch(true);
      return;
    }
    onSubmit(pass);
  };

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      closeOnBackdrop={false}
      initialFocusRef={inputRef}
      title="Back up to the cloud"
      description="Your data is encrypted in this browser before it's uploaded."
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={busy}>
            {busy ? "Uploading…" : "Encrypt and back up"}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={submit} noValidate className="flex flex-col gap-4">
        <Field label="Backup passphrase" hint={localError ? undefined : PASSPHRASE_HINT} error={localError ?? error} required>
          <TextInput
            ref={inputRef}
            type="password"
            autoComplete="new-password"
            value={pass}
            maxLength={128}
            disabled={busy}
            onChange={(e) => {
              setPass(e.target.value);
              setLocalError(null);
              setMismatch(false);
            }}
          />
        </Field>
        <Field label="Confirm passphrase" error={mismatch ? "The passphrases don't match." : null} required>
          <TextInput
            type="password"
            autoComplete="new-password"
            value={confirm}
            maxLength={128}
            disabled={busy}
            onChange={(e) => {
              setConfirm(e.target.value);
              setMismatch(false);
            }}
          />
        </Field>
        <div className="flex items-start gap-2.5 rounded-md border border-text/20 bg-surface px-3 py-2.5 text-[13px] leading-5 text-text/85">
          <IconAlert size={16} className="mt-0.5 shrink-0 text-text" />
          <p>
            <span className="font-semibold text-text">Store this passphrase somewhere safe.</span> It is never saved or
            sent anywhere, so it can&apos;t be recovered. Without it, this backup can&apos;t be restored.
          </p>
        </div>
      </form>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Replace-all warning shared by restore and import (18.7, 18.11)
// ---------------------------------------------------------------------------

function ReplaceWarning({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-md border border-danger/30 bg-danger/[0.05] px-3.5 py-3 text-sm", className)}>
      <p className="font-semibold text-danger">All current data on this device will be replaced.</p>
      <p className="mt-1 leading-5 text-text/85">
        Every profile, chat, memory, activity log, and setting here is swapped for the backup&apos;s contents. Cloud
        backup settings and your namespace ID stay as they are. This can&apos;t be undone.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Restore from cloud (18.6–18.9, 18.16, 18.17)
// ---------------------------------------------------------------------------

export type RestoreDialogProps = {
  open: boolean;
  entries: CloudBackupEntry[];
  busy: boolean;
  /** Error from the last restore attempt; keeps the dialog on the passphrase step. */
  error: string | null;
  onCancel: () => void;
  onRestore: (name: string, passphrase: string) => void;
  onClearError: () => void;
};

type RestoreStep = "select" | "passphrase" | "confirm";

/** Select a backup → passphrase → replace-all confirmation → restore. Mount only while open. */
export function RestoreDialog({ open, entries, busy, error, onCancel, onRestore, onClearError }: RestoreDialogProps) {
  const formId = useId();
  const listName = useId();
  const [step, setStep] = useState<RestoreStep>("select");
  const [selected, setSelected] = useState<string | null>(entries[0]?.name ?? null);
  const [pass, setPass] = useState("");
  const [passError, setPassError] = useState<string | null>(null);

  const entry = entries.find((e) => e.name === selected) ?? null;
  // A failed attempt returns to the passphrase step so it can be corrected.
  const shownStep: RestoreStep = error && !busy ? "passphrase" : step;

  const next = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (shownStep === "select") {
      if (selected) setStep("passphrase");
      return;
    }
    if (shownStep === "passphrase") {
      const v = validatePassphrase(pass);
      if (!v.ok) {
        setPassError(v.error);
        return;
      }
      onClearError();
      setStep("confirm");
      return;
    }
    if (selected) onRestore(selected, pass);
  };

  const back = () => {
    onClearError();
    setStep(shownStep === "confirm" ? "passphrase" : "select");
  };

  const titles: Record<RestoreStep, string> = {
    select: "Restore from the cloud",
    passphrase: "Enter the backup passphrase",
    confirm: "Replace all data?",
  };

  const descriptions: Record<RestoreStep, string> = {
    select: `${entries.length} backup${entries.length === 1 ? "" : "s"} under this browser's namespace, newest first.`,
    passphrase: "Use the passphrase you chose when this backup was made.",
    confirm: "Restoring decrypts the backup in this browser and checks it before anything is replaced.",
  };

  const primaryLabel = shownStep === "select" ? "Continue" : shownStep === "passphrase" ? "Continue" : "Replace and restore";

  return (
    <Dialog
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      closeOnBackdrop={false}
      size="lg"
      tone={shownStep === "confirm" ? "danger" : "default"}
      title={titles[shownStep]}
      description={descriptions[shownStep]}
      actions={
        <>
          {shownStep !== "select" ? (
            <Button variant="ghost" onClick={back} disabled={busy} className="mr-auto">
              Back
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={shownStep === "confirm" ? "danger" : "primary"}
            loading={busy}
            disabled={!selected}
          >
            {busy ? "Restoring…" : primaryLabel}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={next} noValidate>
        {shownStep === "select" ? (
          <fieldset>
            <legend className="sr-only">Choose a backup</legend>
            <ul className="max-h-[min(50vh,360px)] divide-y divide-border overflow-y-auto rounded-md border border-border">
              {entries.map((e, i) => {
                const checked = e.name === selected;
                return (
                  <li key={e.name}>
                    <label
                      className={cn(
                        "flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors",
                        "has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-primary",
                        checked ? "bg-accent/60" : "hover:bg-bg-subtle",
                      )}
                    >
                      <input
                        type="radio"
                        name={listName}
                        value={e.name}
                        checked={checked}
                        onChange={() => setSelected(e.name)}
                        className="size-4 accent-[var(--color-primary)]"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block font-mono text-[13px] tabular-nums text-text">
                          {formatBackupTime(e.createdAt)}
                        </span>
                        <span className="block truncate font-mono text-[11px] text-muted">{e.name}</span>
                      </span>
                      {i === 0 ? <Badge tone="green">Latest</Badge> : null}
                      <span className="shrink-0 font-mono text-[12px] tabular-nums text-muted">
                        {formatBackupSize(e.sizeBytes)}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}

        {shownStep === "passphrase" ? (
          <div className="flex flex-col gap-4">
            {entry ? <SelectedBackup entry={entry} /> : null}
            <Field
              label="Backup passphrase"
              hint={passError || error ? undefined : PASSPHRASE_HINT}
              error={passError ?? error}
              required
            >
              <TextInput
                autoFocus
                type="password"
                autoComplete="current-password"
                value={pass}
                maxLength={128}
                disabled={busy}
                onChange={(e) => {
                  setPass(e.target.value);
                  setPassError(null);
                  if (error) onClearError();
                }}
              />
            </Field>
          </div>
        ) : null}

        {shownStep === "confirm" ? (
          <div className="flex flex-col gap-4">
            {entry ? <SelectedBackup entry={entry} /> : null}
            <ReplaceWarning />
            {busy ? (
              <p role="status" className="flex items-center gap-2 text-sm text-muted">
                <Spinner size={14} /> Downloading, decrypting, and checking the backup…
              </p>
            ) : null}
          </div>
        ) : null}
      </form>
    </Dialog>
  );
}

function SelectedBackup({ entry }: { entry: CloudBackupEntry }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-bg-subtle px-3.5 py-2.5 text-[13px]">
      <dt className="text-muted">Backup</dt>
      <dd className="font-mono tabular-nums text-text">{formatBackupTime(entry.createdAt)}</dd>
      <dt className="text-muted">Size</dt>
      <dd className="font-mono tabular-nums text-text">{formatBackupSize(entry.sizeBytes)}</dd>
    </dl>
  );
}

// ---------------------------------------------------------------------------
// Import confirmation (18.11)
// ---------------------------------------------------------------------------

export type ImportConfirmDialogProps = {
  open: boolean;
  fileName: string;
  sizeBytes: number;
  profileCount: number;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
};

export function ImportConfirmDialog({
  open,
  fileName,
  sizeBytes,
  profileCount,
  busy,
  error,
  onCancel,
  onConfirm,
}: ImportConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      dismissible={!busy}
      closeOnBackdrop={false}
      tone="danger"
      title="Replace all data?"
      description="The file was checked and is a valid backup."
      actions={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            {busy ? "Importing…" : "Replace and import"}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-bg-subtle px-3.5 py-2.5 text-[13px]">
          <dt className="text-muted">File</dt>
          <dd className="truncate font-mono text-text">{fileName}</dd>
          <dt className="text-muted">Size</dt>
          <dd className="font-mono tabular-nums text-text">{formatBackupSize(sizeBytes)}</dd>
          <dt className="text-muted">Profiles</dt>
          <dd className="font-mono tabular-nums text-text">{profileCount}</dd>
        </dl>
        <ReplaceWarning />
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}

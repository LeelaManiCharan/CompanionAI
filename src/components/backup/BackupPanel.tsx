"use client";

import { useCallback, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import {
  Badge,
  Button,
  IconCloudDownload,
  IconCloudUpload,
  IconDownload,
  IconUpload,
  InlineAlert,
  Skeleton,
  Spinner,
  useToast,
} from "@/components/ui";
import type { BackupData } from "@/core/backup";
import type { BrowserRecord } from "@/core/models";
import { cn } from "@/lib/cn";
import {
  applyRestore,
  exportToFile,
  importFromFile,
  listCloudBackups,
  restoreFromCloud,
  type CloudBackupEntry,
} from "@/services/backupService";
import { BackupPassphraseDialog, ImportConfirmDialog, RestoreDialog } from "./BackupDialogs";
import { CloudConfigForm, CloudPrivacyNotice, focusCloudSettings, NamespaceIdRow } from "./CloudConfigForm";
import { formatBackupSize, formatBackupTime } from "./format";
import {
  CONFIG_ERROR_KINDS,
  errorInfo,
  finishRestore,
  preflightCloud,
  useBackupMeta,
  useBackupNow,
  useBrowserRecord,
  useCallActive,
  useOnline,
  useRepoWritable,
} from "./hooks";

export type BackupPanelProps = {
  /** Show the "Back up now" control (hidden on the zero-profile screen). */
  showBackup?: boolean;
  /** Show the "Export file" control. */
  showExport?: boolean;
  className?: string;
};

/**
 * Cloud backup settings and actions (Req 7, 18, 20.16, 20.18, 20.28, 20.29):
 * Supabase config, namespace ID, RLS notice, and Backup / Restore / Export /
 * Import. Everything here is shared by all profiles in this browser.
 */
export function BackupPanel({ showBackup = true, showExport = true, className }: BackupPanelProps) {
  const { record, loading } = useBrowserRecord();
  const canWrite = useRepoWritable();

  return (
    <div className={cn("flex flex-col gap-8", className)}>
      <div className="flex flex-col gap-4">
        <SubHeading title="Supabase connection" meta="Shared by all profiles in this browser" />
        {loading ? (
          <div aria-busy="true" className="flex flex-col gap-4">
            <span className="sr-only">Loading cloud settings</span>
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : (
          <CloudConfigForm record={record ?? null} disabled={!canWrite} />
        )}
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-6">
        <NamespaceIdRow namespaceId={record?.backupNamespaceId ?? null} disabled={!canWrite} />
        <CloudPrivacyNotice />
      </div>

      <div className="flex flex-col gap-4 border-t border-border pt-6">
        <SubHeading title="Backup and restore" meta="Encrypted with your passphrase" />
        <BackupActions record={record} canWrite={canWrite} showBackup={showBackup} showExport={showExport} />
      </div>
    </div>
  );
}

function SubHeading({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-text">{title}</h3>
      {meta ? <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">{meta}</span> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Busy = null | "list" | "restore" | "export" | "import-read" | "import-apply";

type Notice = {
  tone: "success" | "danger" | "info";
  title: string;
  body?: ReactNode;
  /** Show a control that jumps to the Cloud_Store fields. */
  configure?: boolean;
};

const BUSY_LABEL: Record<Exclude<Busy, null> | "backup", string> = {
  backup: "Encrypting and uploading your backup…",
  list: "Loading backups from cloud storage…",
  restore: "Downloading and restoring the backup…",
  export: "Preparing your backup file…",
  "import-read": "Checking the backup file…",
  "import-apply": "Replacing data with the imported backup…",
};

/** Only these restore errors keep the dialog open so the passphrase can be re-entered. */
const RESTORE_RETRY_KINDS: ReadonlySet<string> = new Set(["decrypt_failed", "passphrase_length"]);

function BackupActions({
  record,
  canWrite,
  showBackup,
  showExport,
}: {
  record: BrowserRecord | null | undefined;
  canWrite: boolean;
  showBackup: boolean;
  showExport: boolean;
}) {
  const { toast } = useToast();
  const online = useOnline();
  const callActive = useCallActive();
  const metas = useBackupMeta();
  const fileRef = useRef<HTMLInputElement>(null);

  const [busy, setBusy] = useState<Busy>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const [restoreEntries, setRestoreEntries] = useState<CloudBackupEntry[] | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const [imported, setImported] = useState<{ data: BackupData; fileName: string; size: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const onBackedUp = useCallback(
    () => toast({ title: "Backup complete", tone: "success" }),
    [toast],
  );
  const backup = useBackupNow(record, onBackedUp);

  const anyBusy = busy !== null || backup.busy;
  const busyLabel = backup.busy ? BUSY_LABEL.backup : busy ? BUSY_LABEL[busy] : null;

  const backupDisabled = !canWrite || anyBusy || !online;
  const restoreDisabled = !canWrite || anyBusy || !online || callActive;
  const importDisabled = !canWrite || anyBusy || callActive;
  const exportDisabled = !canWrite || anyBusy;

  // -- Backup -----------------------------------------------------------------

  const startBackup = () => {
    setNotice(null);
    backup.start();
  };

  // -- Restore ----------------------------------------------------------------

  const startRestore = async () => {
    if (restoreDisabled) return;
    setNotice(null);
    backup.clearOutcome();
    const pre = preflightCloud(record);
    if (!pre.ok) {
      setNotice({ tone: "danger", title: "Can't restore yet", body: pre.message, configure: true });
      return;
    }
    setBusy("list");
    const res = await listCloudBackups();
    setBusy(null);
    if (!res.ok) {
      setNotice({
        tone: "danger",
        title: "Couldn't list backups",
        body: res.error.message,
        configure: CONFIG_ERROR_KINDS.has(res.error.kind),
      });
      return;
    }
    if (res.value.length === 0) {
      setNotice({
        tone: "info",
        title: "No backups are available",
        body: "Nothing is stored under this browser's namespace ID yet. To restore from another browser, paste its namespace ID above.",
      });
      return;
    }
    setRestoreError(null);
    setRestoreEntries(res.value);
  };

  const runRestore = async (name: string, passphrase: string) => {
    setBusy("restore");
    setRestoreError(null);
    const res = await restoreFromCloud(name, passphrase);
    if (res.ok) {
      // Keep the busy state: the page reloads into the restored data.
      finishRestore(res.value);
      return;
    }
    setBusy(null);
    if (RESTORE_RETRY_KINDS.has(res.error.kind)) {
      setRestoreError(res.error.message);
      return;
    }
    setRestoreEntries(null);
    setNotice({
      tone: "danger",
      title: "Restore failed. Nothing was changed.",
      body: res.error.message,
      configure: CONFIG_ERROR_KINDS.has(res.error.kind),
    });
  };

  // -- Export -----------------------------------------------------------------

  const runExport = async () => {
    if (exportDisabled) return;
    setNotice(null);
    setBusy("export");
    const res = await exportToFile();
    setBusy(null);
    if (!res.ok) {
      setNotice({ tone: "danger", title: "Export failed", body: res.error.message });
      return;
    }
    setNotice({
      tone: "success",
      title: "Backup file downloaded",
      body: (
        <span className="font-mono text-[13px]">
          {res.value.fileName} · {formatBackupSize(res.value.sizeBytes)}
        </span>
      ),
    });
  };

  // -- Import -----------------------------------------------------------------

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow choosing the same file again
    if (!file || importDisabled) return;
    setNotice(null);
    setBusy("import-read");
    const res = await importFromFile(file);
    setBusy(null);
    if (!res.ok) {
      setNotice({ tone: "danger", title: "That file can't be imported. Nothing was changed.", body: res.error.message });
      return;
    }
    setImportError(null);
    setImported({ data: res.value, fileName: file.name, size: file.size });
  };

  const confirmImport = async () => {
    if (!imported) return;
    setBusy("import-apply");
    setImportError(null);
    const res = await applyRestore(imported.data);
    if (res.ok) {
      finishRestore(res.value);
      return;
    }
    setBusy(null);
    setImportError(res.error.message);
  };

  // -- Render -----------------------------------------------------------------

  const backupOutcome = backup.outcome;
  const latest = metas[0] ?? null;

  return (
    <div className="flex flex-col gap-4">
      <LastBackupLine latest={latest} />

      <div className="flex flex-wrap gap-2">
        {showBackup ? (
          <Button
            onClick={startBackup}
            disabled={backupDisabled}
            loading={backup.busy}
            leadingIcon={<IconCloudUpload size={16} />}
          >
            Back up now
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={startRestore}
          disabled={restoreDisabled}
          loading={busy === "list" || busy === "restore"}
          leadingIcon={<IconCloudDownload size={16} />}
        >
          Restore
        </Button>
        {showExport ? (
          <Button
            variant="secondary"
            onClick={runExport}
            disabled={exportDisabled}
            loading={busy === "export"}
            leadingIcon={<IconDownload size={16} />}
          >
            Export file
          </Button>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => fileRef.current?.click()}
          disabled={importDisabled}
          loading={busy === "import-read" || busy === "import-apply"}
          leadingIcon={<IconUpload size={16} />}
        >
          Import file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFile}
        />
      </div>

      {busyLabel ? (
        <div role="status" className="flex items-center gap-2.5 rounded-md border border-border bg-bg-subtle px-3.5 py-2.5 text-sm text-text">
          <Spinner size={16} className="text-primary" />
          <span>{busyLabel}</span>
        </div>
      ) : null}

      {!online ? (
        <InlineAlert tone="warning" title="You're offline">
          Backup and restore are turned off until you reconnect. Export and import still work.
        </InlineAlert>
      ) : null}

      {callActive ? (
        <InlineAlert tone="warning" title="A call is in progress">
          End the call before restoring or importing a backup.
        </InlineAlert>
      ) : null}

      {backupOutcome?.ok ? (
        <InlineAlert tone="success" title="Backup complete" onDismiss={backup.clearOutcome}>
          <span className="font-mono text-[13px] tabular-nums">
            {formatBackupTime(backupOutcome.value.meta.createdAt)} · {formatBackupSize(backupOutcome.value.meta.sizeBytes)}
          </span>
        </InlineAlert>
      ) : null}

      {backupOutcome && !backupOutcome.ok ? (
        <NoticeAlert
          notice={{
            tone: "danger",
            title: "Backup didn't run",
            body: errorInfo(backupOutcome.error).message,
            configure: CONFIG_ERROR_KINDS.has(errorInfo(backupOutcome.error).kind),
          }}
          onDismiss={backup.clearOutcome}
        />
      ) : null}

      {notice ? <NoticeAlert notice={notice} onDismiss={() => setNotice(null)} /> : null}

      {backup.dialogOpen ? (
        <BackupPassphraseDialog
          open
          busy={backup.busy}
          error={backup.dialogError}
          onCancel={backup.cancel}
          onSubmit={(p) => void backup.submit(p)}
        />
      ) : null}

      {restoreEntries ? (
        <RestoreDialog
          open
          entries={restoreEntries}
          busy={busy === "restore"}
          error={restoreError}
          onCancel={() => {
            if (busy === "restore") return;
            setRestoreEntries(null);
            setRestoreError(null);
          }}
          onRestore={(name, pass) => void runRestore(name, pass)}
          onClearError={() => setRestoreError(null)}
        />
      ) : null}

      {imported ? (
        <ImportConfirmDialog
          open
          fileName={imported.fileName}
          sizeBytes={imported.size}
          profileCount={imported.data.profiles.length}
          busy={busy === "import-apply"}
          error={importError}
          onCancel={() => {
            if (busy === "import-apply") return;
            setImported(null);
            setImportError(null);
          }}
          onConfirm={() => void confirmImport()}
        />
      ) : null}
    </div>
  );
}

function NoticeAlert({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <InlineAlert
      tone={notice.tone}
      title={notice.title}
      onDismiss={onDismiss}
      actions={
        notice.configure ? (
          <Button variant="secondary" className="h-8 px-3 text-[13px]" onClick={focusCloudSettings}>
            Open cloud storage settings
          </Button>
        ) : undefined
      }
    >
      {notice.body}
    </InlineAlert>
  );
}

function LastBackupLine({ latest }: { latest: { createdAt: string; sizeBytes: number; location: string } | null }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      <span className="text-muted">Last backup</span>
      {latest ? (
        <>
          <span className="font-mono text-[13px] tabular-nums text-text">
            {formatBackupTime(latest.createdAt)} · {formatBackupSize(latest.sizeBytes)}
          </span>
          <Badge tone={latest.location === "cloud" ? "green" : "neutral"}>
            {latest.location === "cloud" ? "Cloud" : "File"}
          </Badge>
        </>
      ) : (
        <span className="font-mono text-[13px] text-muted">None yet</span>
      )}
    </div>
  );
}

"use client";

import { Badge, Button, ButtonLink, Card, IconCloudUpload, InlineAlert } from "@/components/ui";
import { cn } from "@/lib/cn";
import { BackupPassphraseDialog } from "./BackupDialogs";
import { formatBackupSize, formatBackupTime } from "./format";
import {
  CONFIG_ERROR_KINDS,
  errorInfo,
  useBackupMeta,
  useBackupNow,
  useBrowserRecord,
  useOnline,
  useRepoWritable,
} from "./hooks";

export const CLOUD_SETTINGS_HREF = "/settings#cloud-backup";

/**
 * Compact "Back up now" card for the Home page (3.6, 18.2–18.5, 20.16):
 * last backup time and size, and the passphrase flow. Configuration lives in
 * Settings; an incomplete setup links there and sends no requests.
 */
export function BackupCard({ className }: { className?: string }) {
  const { record } = useBrowserRecord();
  const metas = useBackupMeta();
  const online = useOnline();
  const canWrite = useRepoWritable();
  const backup = useBackupNow(record);

  const latest = metas[0] ?? null;
  const configured = Boolean(record?.cloudStoreConfig?.supabaseAnonKey);
  const outcome = backup.outcome;
  const failure = outcome && !outcome.ok ? errorInfo(outcome.error) : null;

  return (
    <Card as="section" aria-labelledby="backup-card-title" className={cn("p-5", className)}>
      <div className="flex items-start gap-4">
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-accent text-primary"
        >
          <IconCloudUpload size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="backup-card-title" className="text-base font-semibold tracking-[-0.02em] text-text">
              Back up your data
            </h2>
            {configured ? null : <Badge>Not set up</Badge>}
          </div>
          <p className="mt-0.5 text-sm text-muted">Encrypted with your passphrase before it leaves this browser.</p>
          <p className="mt-2 text-[13px] text-muted">
            Last backup{" "}
            <span className="font-mono tabular-nums text-text">
              {latest ? `${formatBackupTime(latest.createdAt)} · ${formatBackupSize(latest.sizeBytes)}` : "none yet"}
            </span>
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          onClick={backup.start}
          loading={backup.busy}
          disabled={!canWrite || !online || backup.busy}
          leadingIcon={<IconCloudUpload size={16} />}
        >
          Back up now
        </Button>
        <ButtonLink href={CLOUD_SETTINGS_HREF} variant="ghost">
          Backup settings
        </ButtonLink>
      </div>

      {!online ? (
        <p className="mt-3 text-[13px] text-muted">You&apos;re offline. Backup will be available when you reconnect.</p>
      ) : null}

      {outcome?.ok ? (
        <InlineAlert tone="success" title="Backup complete" onDismiss={backup.clearOutcome} className="mt-4">
          <span className="font-mono text-[13px] tabular-nums">
            {formatBackupTime(outcome.value.meta.createdAt)} · {formatBackupSize(outcome.value.meta.sizeBytes)}
          </span>
        </InlineAlert>
      ) : null}

      {failure ? (
        <InlineAlert
          tone="danger"
          title="Backup didn't run"
          onDismiss={backup.clearOutcome}
          className="mt-4"
          actions={
            CONFIG_ERROR_KINDS.has(failure.kind) ? (
              <ButtonLink href={CLOUD_SETTINGS_HREF} variant="secondary" className="h-8 px-3 text-[13px]">
                Open cloud storage settings
              </ButtonLink>
            ) : undefined
          }
        >
          {failure.message}
        </InlineAlert>
      ) : null}

      {backup.dialogOpen ? (
        <BackupPassphraseDialog
          open
          busy={backup.busy}
          error={backup.dialogError}
          onCancel={backup.cancel}
          onSubmit={(p) => void backup.submit(p)}
        />
      ) : null}
    </Card>
  );
}

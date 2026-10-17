"use client";

import { useRepo, useLiveQuery } from "@/data/useLiveQuery";
import { Badge, ButtonLink, Card, IconCloudUpload, Skeleton } from "@/components/ui";
import { formatBytes, fullDateTime, relativeTime } from "./format";

/** Last backup time/size with a "Back up now" link to Settings (3.6). */
export function BackupSummaryCard({ nowMs }: { nowMs: number }) {
  const repo = useRepo();
  const { data, error, loading } = useLiveQuery(async () => (repo ? repo.listBackupMeta() : []), ["backupMeta"], [repo]);
  const last = data?.[0];

  return (
    <Card as="section" aria-labelledby="backup-heading" className="p-5">
      <div className="flex items-start gap-3.5">
        <span
          aria-hidden="true"
          className="flex size-9 shrink-0 items-center justify-center rounded-md border border-primary/15 bg-accent text-primary"
        >
          <IconCloudUpload size={18} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 id="backup-heading" className="text-base font-semibold tracking-[-0.02em] text-text">
              Backup
            </h2>
            {last ? <Badge tone="green">{last.location === "cloud" ? "Cloud" : "File"}</Badge> : null}
          </div>
          {loading && data === undefined ? (
            <Skeleton className="mt-2 h-3.5 w-3/4" />
          ) : error ? (
            <p className="mt-0.5 text-sm text-muted">Backup history couldn&apos;t be read.</p>
          ) : last ? (
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-muted">Last backup</dt>
              <dd className="text-right font-mono text-[13px] tabular-nums text-text">
                <time dateTime={last.createdAt} title={fullDateTime(last.createdAt)}>
                  {relativeTime(last.createdAt, nowMs)}
                </time>
              </dd>
              <dt className="text-muted">Size</dt>
              <dd className="text-right font-mono text-[13px] tabular-nums text-text">{formatBytes(last.sizeBytes)}</dd>
            </dl>
          ) : (
            <p className="mt-0.5 text-sm text-muted">
              No backups yet. Everything lives only in this browser until you back it up.
            </p>
          )}
        </div>
      </div>
      <ButtonLink
        href="/settings#cloud-backup"
        variant={last ? "secondary" : "primary"}
        fullWidth
        className="mt-4"
        leadingIcon={<IconCloudUpload size={16} />}
      >
        Back up now
      </ButtonLink>
    </Card>
  );
}

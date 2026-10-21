"use client";

/**
 * Activity page (Req 11.1, 11.5, 11.6, 11.8): what is tracked and why, the
 * tracking status with a link to Settings, every Activity_Log of the
 * Active_Profile newest first, and a confirmed "Clear all".
 */
import { useMemo, useState } from "react";
import { AppShell, useActiveProfile, useCanWrite, useSettings } from "@/components/app";
import {
  durationLabel,
  formatDateTime,
  formatDay,
  formatDuration,
  formatTime,
  sameLocalDay,
} from "@/components/memories/format";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  IconActivity,
  IconSettings,
  IconTrash,
  InlineAlert,
  Reveal,
  Skeleton,
  useToast,
} from "@/components/ui";
import type { ActivityLog } from "@/core/models";
import { useLiveQuery, useRepo } from "@/data/useLiveQuery";
import { clearActivity } from "@/services/activityTracker";

const SETTINGS_HREF = "/settings#activity";

const TRACKED = [
  { term: "Session start", detail: "when this tab became visible" },
  { term: "Session end", detail: "when the tab was hidden or closed" },
  { term: "Duration", detail: "the time in between, in seconds" },
  { term: "Page", detail: "the page you were on, like /chat" },
] as const;

const byNewest = (a: ActivityLog, b: ActivityLog) => Date.parse(b.startedAt) - Date.parse(a.startedAt);

export default function ActivityPage() {
  const profile = useActiveProfile();
  const settings = useSettings();
  const canWrite = useCanWrite();
  const repo = useRepo();
  const { toast } = useToast();
  const profileId = profile.id;
  const enabled = settings.activityTrackingEnabled;

  const logsQ = useLiveQuery(
    async () => (repo ? (await repo.activityByProfile(profileId)).sort(byNewest) : []),
    ["activityLogs"],
    [repo, profileId],
  );
  const logs = logsQ.data;
  const totalSeconds = useMemo(() => (logs ?? []).reduce((sum, l) => sum + l.durationSeconds, 0), [logs]);

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);

  const closeConfirm = () => {
    if (!clearing) setConfirmOpen(false);
  };

  const confirmClear = async () => {
    if (clearing) return;
    setClearing(true);
    const res = await clearActivity(profileId);
    setClearing(false);
    setConfirmOpen(false);
    if (!res.ok) {
      // 11.8: the stored logs are unchanged.
      setClearError(res.error);
      return;
    }
    setClearError(null);
    toast({ title: "Activity cleared", description: "All recorded sessions for this profile were deleted." });
  };

  const hasLogs = (logs?.length ?? 0) > 0;

  return (
    <AppShell>
      <header className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-gradient-brand">Activity</p>
        <h1 className="text-[28px] leading-tight tracking-[-0.03em] text-text">Your activity</h1>
        <p className="max-w-xl text-muted">
          A record of when {profile.displayName} used the app, kept on this device so {settings.botName} can pick a good
          time for your daily check-in.
        </p>
      </header>

      <div className="mt-8 grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)] lg:items-start">
        <aside className="flex flex-col gap-4 lg:sticky lg:top-20">
          <Reveal>
            <Card as="section" aria-labelledby="tracking-title" className="p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 id="tracking-title" className="text-base tracking-[-0.02em] text-text">
                  Tracking
                </h2>
                <Badge tone={enabled ? "green" : "neutral"} dot>
                  {enabled ? "On" : "Off"}
                </Badge>
              </div>
              <p className="mt-2 text-sm leading-6 text-muted">
                {enabled
                  ? "New sessions are recorded while this tab is open and visible."
                  : "Nothing new is being recorded. Sessions below, if any, were saved earlier."}
              </p>
              <ButtonLink
                href={SETTINGS_HREF}
                variant="secondary"
                className="mt-4"
                fullWidth
                leadingIcon={<IconSettings size={16} />}
              >
                {enabled ? "Turn off in Settings" : "Turn on in Settings"}
              </ButtonLink>
            </Card>
          </Reveal>

          <Reveal delay={80}>
            <Card as="section" muted aria-labelledby="disclosure-title" className="p-5">
              <h2 id="disclosure-title" className="text-base tracking-[-0.02em] text-text">
                What&apos;s tracked
              </h2>
              <p className="mt-1 text-sm text-muted">Only these four things, nothing else:</p>
              <dl className="mt-3 flex flex-col gap-2.5 text-sm">
                {TRACKED.map((t) => (
                  <div key={t.term} className="flex flex-col">
                    <dt className="font-medium text-text">{t.term}</dt>
                    <dd className="text-muted">{t.detail}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 border-t border-border pt-3 text-[13px] leading-5 text-muted">
                Used only to schedule check-ins. It never leaves this device unless you include it in a backup.
              </p>
            </Card>
          </Reveal>
        </aside>

        <section aria-labelledby="sessions-title" className="min-w-0">
          {clearError ? (
            <InlineAlert
              tone="danger"
              title="Activity could not be cleared"
              className="mb-4"
              onDismiss={() => setClearError(null)}
            >
              {clearError}
            </InlineAlert>
          ) : null}

          <Reveal delay={120}>
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-5">
                <div className="min-w-0">
                  <h2 id="sessions-title" className="text-base tracking-[-0.02em] text-text">
                    Sessions
                  </h2>
                  {hasLogs ? (
                    <p className="mt-0.5 font-mono text-[12px] tabular-nums text-muted">
                      {logs!.length} {logs!.length === 1 ? "session" : "sessions"} ·{" "}
                      <span aria-label={durationLabel(totalSeconds)}>{formatDuration(totalSeconds)}</span> total
                    </p>
                  ) : null}
                </div>
                <Button
                  variant="ghost"
                  className="text-danger! hover:bg-danger/[0.05]!"
                  leadingIcon={<IconTrash size={16} />}
                  onClick={() => setConfirmOpen(true)}
                  disabled={!canWrite || !hasLogs}
                >
                  Clear all
                </Button>
              </div>

              {logsQ.loading && !logs ? (
                <div aria-busy="true" className="flex flex-col gap-3 px-5 py-5">
                  <span className="sr-only">Loading activity</span>
                  {[0, 1, 2, 3].map((i) => (
                    <Skeleton key={i} className="h-5!" />
                  ))}
                </div>
              ) : logsQ.error && !logs ? (
                <div className="p-5">
                  <InlineAlert tone="danger" title="Activity could not be loaded">
                    Your stored activity was not changed. Try reloading the page.
                  </InlineAlert>
                </div>
              ) : !hasLogs ? (
                <div className="p-5">
                  <EmptyState
                    icon={<IconActivity size={18} />}
                    title="No activity recorded"
                    description={
                      enabled
                        ? "Sessions show up here after you switch away from or close this tab."
                        : "Tracking is off, so no sessions are recorded."
                    }
                    actions={
                      enabled ? null : (
                        <ButtonLink href={SETTINGS_HREF} variant="secondary">
                          Open Settings
                        </ButtonLink>
                      )
                    }
                  />
                </div>
              ) : (
                <SessionsTable logs={logs!} />
              )}
            </Card>
          </Reveal>
        </section>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={closeConfirm}
        tone="danger"
        size="sm"
        title="Clear all activity?"
        description={`This deletes all ${logs?.length ?? 0} recorded ${
          logs?.length === 1 ? "session" : "sessions"
        } for ${profile.displayName}. Other profiles are not affected. This can't be undone.`}
        actions={
          <>
            <Button variant="secondary" onClick={closeConfirm} disabled={clearing}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmClear} loading={clearing}>
              Clear activity
            </Button>
          </>
        }
      />
    </AppShell>
  );
}

function SessionsTable({ logs }: { logs: ActivityLog[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <caption className="sr-only">Recorded sessions, most recent first</caption>
        <thead>
          <tr className="border-b border-border/70">
            {["Started", "Ended", "Duration", "Page"].map((h, i) => (
              <th
                key={h}
                scope="col"
                className={
                  "px-5 py-2.5 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted " +
                  (i === 2 ? "text-right" : "")
                }
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {logs.map((l) => (
            <tr key={l.id} className="transition-colors hover:bg-bg-subtle">
              <td className="whitespace-nowrap px-5 py-3">
                <time dateTime={l.startedAt} title={formatDateTime(l.startedAt)} className="font-mono text-[13px]">
                  <span className="text-muted">{formatDay(l.startedAt)}</span>{" "}
                  <span className="text-text">{formatTime(l.startedAt)}</span>
                </time>
              </td>
              <td className="whitespace-nowrap px-5 py-3">
                <time dateTime={l.endedAt} title={formatDateTime(l.endedAt)} className="font-mono text-[13px]">
                  {sameLocalDay(l.startedAt, l.endedAt) ? null : (
                    <span className="text-muted">{formatDay(l.endedAt)} </span>
                  )}
                  <span className="text-text">{formatTime(l.endedAt)}</span>
                </time>
              </td>
              <td className="whitespace-nowrap px-5 py-3 text-right">
                <span className="font-mono text-[13px] tabular-nums text-text" aria-label={durationLabel(l.durationSeconds)}>
                  {formatDuration(l.durationSeconds)}
                </span>
              </td>
              <td className="max-w-[16rem] px-5 py-3">
                <PageCell page={l.page} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PageCell({ page }: { page: string }) {
  return (
    <code
      title={page}
      className="inline-block max-w-full truncate rounded-sm border border-border bg-surface px-1.5 py-0.5 align-middle font-mono text-[12px] text-text/85"
    >
      {page}
    </code>
  );
}

"use client";

import { useState } from "react";
import { useLiveQuery, useRepo } from "@/data/useLiveQuery";
import { cancelReminder } from "@/services/reminderService";
import { Button, Card, IconPhone, Skeleton } from "@/components/ui";
import { clockTime, fullDateTime } from "./format";

function dayLabel(iso: string, nowMs: number): string {
  const d = new Date(Date.parse(iso));
  const today = new Date(nowMs);
  const tomorrow = new Date(nowMs);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return "Today";
  if (same(d, tomorrow)) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(d);
}

/** Pending reminders of the Active_Profile with Cancel (24.8). */
export function UpcomingRemindersCard({ profileId, nowMs }: { profileId: string; nowMs: number }) {
  const repo = useRepo();
  const { data, error, loading } = useLiveQuery(
    async () => (repo ? (await repo.remindersByProfile(profileId)).filter((r) => r.status === "pending") : []),
    ["reminders"],
    [repo, profileId],
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  async function onCancel(id: string) {
    setBusyId(id);
    setCancelError(null);
    const res = await cancelReminder(id);
    setBusyId(null);
    if (!res.ok) setCancelError(res.error);
  }

  return (
    <Card as="section" aria-labelledby="reminders-heading" className="overflow-hidden">
      <h2
        id="reminders-heading"
        className="px-5 pb-2 pt-5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-gradient-brand"
      >
        Upcoming reminders
      </h2>
      {loading && data === undefined ? (
        <div className="px-5 py-4">
          <Skeleton className="h-3.5 w-3/4" />
        </div>
      ) : error ? (
        <p className="px-5 py-4 text-sm text-muted">Reminders couldn&apos;t be read.</p>
      ) : data && data.length > 0 ? (
        <ul className="flex flex-col gap-0.5 px-2 pb-2">
          {data.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition-colors hover:bg-bg-subtle">
              <span
                aria-hidden="true"
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-primary-deep"
              >
                <IconPhone size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium tracking-[-0.01em] text-text">{r.text}</span>
                <time
                  dateTime={r.dueAt}
                  title={fullDateTime(r.dueAt)}
                  className="block font-mono text-[12px] tabular-nums text-muted"
                >
                  {nowMs ? `${dayLabel(r.dueAt, nowMs)} ${clockTime(r.dueAt)}` : clockTime(r.dueAt)}
                </time>
              </span>
              <Button
                variant="ghost"
                size="sm"
                loading={busyId === r.id}
                onClick={() => void onCancel(r.id)}
                aria-label={`Cancel reminder: ${r.text}`}
              >
                Cancel
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm text-muted">
          No reminders yet. Ask in chat, like &ldquo;remind me to stretch at 15:00&rdquo;.
        </p>
      )}
      {cancelError ? (
        <p role="alert" className="px-5 pb-3 text-sm text-danger">
          {cancelError}
        </p>
      ) : null}
      <p className="px-5 pb-4 pt-1 text-[12px] text-muted">
        Reminders ring while Companion is open in a browser tab.
      </p>
    </Card>
  );
}

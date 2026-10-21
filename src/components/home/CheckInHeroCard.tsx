"use client";

import { useState } from "react";
import type { CheckIn, Reminder } from "@/core/models";
import { localDate, resolveLocalTime } from "@/core/schedule";
import { currentTimeZone } from "@/services/activityTracker";
import { cancelReminder } from "@/services/reminderService";
import { Badge, Button, ButtonLink, Card, IconCheck, IconMessage, IconPhone, Skeleton } from "@/components/ui";
import { clockTime, fullDateTime, zoneLabel } from "./format";

export type CheckInHeroCardProps = {
  botName: string;
  /** Preferred_Check_In_Time `HH:MM` in local time; undefined while loading or if it could not be read. */
  preferredTime: string | undefined;
  /** Today's record (null when none yet); undefined while loading. */
  today: CheckIn | null | undefined;
  /** Pending reminders of the active profile. */
  reminders: Reminder[];
  loading: boolean;
  nowMs: number;
  /** A call is active in another tab; the Start call control is disabled. */
  callElsewhere: boolean;
};

type NextCall =
  | { kind: "reminder"; at: string; reminder: Reminder }
  | { kind: "checkin"; at: string };

const DAY_MS = 86_400_000;

function safeResolve(date: string, hhmm: string, tz: string): string | null {
  try {
    return resolveLocalTime(date, hhmm, tz);
  } catch {
    return null;
  }
}

/** Next Daily_Check_In occurrence: today's time if still ahead and not yet triggered, otherwise tomorrow's. */
function nextCheckIn(preferredTime: string | undefined, today: CheckIn | null | undefined, nowMs: number, tz: string): string | null {
  if (!preferredTime || !nowMs) return null;
  const todayDate = localDate(new Date(nowMs).toISOString(), tz);
  if (!today) {
    const at = safeResolve(todayDate, preferredTime, tz);
    if (at && Date.parse(at) > nowMs) return at;
  }
  const noon = safeResolve(todayDate, "12:00", tz);
  const base = noon ? Date.parse(noon) : nowMs;
  const tomorrow = localDate(new Date(base + DAY_MS).toISOString(), tz);
  return safeResolve(tomorrow, preferredTime, tz);
}

function pickNextCall(
  preferredTime: string | undefined,
  today: CheckIn | null | undefined,
  reminders: Reminder[],
  nowMs: number,
  tz: string,
): NextCall | null {
  const reminder = reminders
    .filter((r) => r.status === "pending" && Date.parse(r.dueAt) > nowMs)
    .sort((a, b) => Date.parse(a.dueAt) - Date.parse(b.dueAt))[0];
  const checkIn = nextCheckIn(preferredTime, today, nowMs, tz);
  if (reminder && (!checkIn || Date.parse(reminder.dueAt) <= Date.parse(checkIn))) {
    return { kind: "reminder", at: reminder.dueAt, reminder };
  }
  return checkIn ? { kind: "checkin", at: checkIn } : null;
}

function dayLabel(at: string, nowMs: number, tz: string): string {
  const target = localDate(at, tz);
  if (target === localDate(new Date(nowMs).toISOString(), tz)) return "Today";
  if (target === localDate(new Date(nowMs + DAY_MS).toISOString(), tz)) return "Tomorrow";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(Date.parse(at));
}

function countdown(at: string, nowMs: number): string {
  const mins = Math.max(1, Math.ceil((Date.parse(at) - nowMs) / 60_000));
  if (mins < 60) return `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}

function todayStatus(botName: string, today: CheckIn | null | undefined): string {
  if (today?.completedAt) return `Completed at ${clockTime(today.completedAt)}`;
  if (today?.snoozedUntil && !today.snoozeFiredAt) return `Snoozed until ${clockTime(today.snoozedUntil)}`;
  if (today) return `${botName} reached out at ${clockTime(today.triggeredAt)}`;
  return "Not yet";
}

/** Concentric "dial" rings in accent green; purely decorative. */
function RingMotif() {
  return (
    <div aria-hidden="true" className="relative hidden size-[220px] shrink-0 md:block">
      <div className="absolute inset-[18px] rounded-full bg-gradient-brand opacity-[0.14] blur-xl animate-float-soft" />
      <svg viewBox="0 0 220 220" className="absolute inset-0 size-full" fill="none">
        <circle cx="110" cy="110" r="108" stroke="var(--color-accent)" strokeWidth="1.5" />
        <circle cx="110" cy="110" r="84" stroke="var(--color-accent)" strokeWidth="1.5" />
        <circle cx="110" cy="110" r="60" fill="var(--color-accent)" />
        <circle cx="110" cy="110" r="108" stroke="var(--color-primary)" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="2 6" />
      </svg>
      <span className="absolute left-1/2 top-1/2 flex size-[72px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-gradient-brand text-white shadow-glow animate-ring-soft">
        <IconPhone size={28} className="relative z-10" />
      </span>
    </div>
  );
}

/** Home hero: the soonest upcoming call (reminder or Daily_Check_In), today's check-in status, and call / chat controls. */
export function CheckInHeroCard({ botName, preferredTime, today, reminders, loading, nowMs, callElsewhere }: CheckInHeroCardProps) {
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState(false);
  const completed = Boolean(today?.completedAt);
  const zone = nowMs ? zoneLabel(nowMs) : "";
  const tz = currentTimeZone();
  // Recomputed on every `useNow` tick, so the hero moves on once the shown time passes.
  const next = nowMs ? pickNextCall(preferredTime, today, reminders, nowMs, tz) : null;
  const waiting = loading && preferredTime === undefined;

  async function onCancel(id: string) {
    setCancelling(true);
    setCancelError(false);
    const res = await cancelReminder(id);
    setCancelling(false);
    if (!res.ok) setCancelError(true);
  }

  const copy = !next
    ? "Start a call or a chat whenever you're ready."
    : next.kind === "reminder"
      ? `${botName} will call to remind you: ${next.reminder.text}`
      : `${botName} will check in to see how your day is going.`;

  return (
    <Card
      as="section"
      aria-labelledby="nextcall-heading"
      className="relative overflow-hidden animate-fade-up shadow-elevated"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-gradient-brand" />
      <span
        aria-hidden="true"
        className="absolute -right-24 -top-24 size-64 rounded-full bg-gradient-brand opacity-[0.08] blur-3xl"
      />
      <div className="flex items-center justify-between gap-8 p-6 sm:p-8 sm:pl-9">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2 id="nextcall-heading" className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              Next call
            </h2>
            {waiting ? (
              <Skeleton className="h-[22px] w-24" />
            ) : next?.kind === "reminder" ? (
              <Badge tone="green" dot>
                Reminder
              </Badge>
            ) : next ? (
              <Badge tone="neutral" dot>
                Daily check-in
              </Badge>
            ) : null}
          </div>

          <div className="mt-5">
            {waiting ? (
              <Skeleton className="h-12 w-36" />
            ) : (
              <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <time
                  dateTime={next?.at}
                  aria-label={next ? `Next call ${fullDateTime(next.at)}` : undefined}
                  className="font-mono text-[44px] font-medium leading-none tracking-[-0.04em] text-text tabular-nums"
                >
                  {next ? clockTime(next.at) : "--:--"}
                </time>
                {next ? (
                  <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                    {dayLabel(next.at, nowMs, tz)} · {countdown(next.at, nowMs)}
                    {zone ? ` · ${zone}` : ""}
                  </span>
                ) : null}
              </p>
            )}
          </div>

          <p className="mt-4 max-w-md break-words text-[15px] leading-6 text-muted">{copy}</p>

          {next?.kind === "reminder" ? (
            <div className="mt-2">
              <Button
                variant="ghost"
                size="sm"
                disabled={cancelling}
                onClick={() => void onCancel(next.reminder.id)}
                aria-label={`Cancel reminder: ${next.reminder.text}`}
              >
                {cancelling ? "Cancelling…" : "Cancel reminder"}
              </Button>
              {cancelError ? (
                <p role="alert" className="mt-1 text-[13px] text-muted">
                  Couldn&apos;t cancel the reminder. Please try again.
                </p>
              ) : null}
            </div>
          ) : null}

          <p className="mt-4 flex flex-wrap items-center gap-2 text-[13px] text-muted">
            <span className="font-mono text-[11px] uppercase tracking-[0.06em]">Today&apos;s check-in</span>
            {loading && today === undefined ? (
              <Skeleton className="h-[18px] w-20" />
            ) : completed ? (
              <span className="inline-flex items-center gap-1 font-medium text-primary">
                {todayStatus(botName, today)} <IconCheck size={12} strokeWidth={2.25} aria-hidden="true" />
              </span>
            ) : (
              <span>{todayStatus(botName, today)}</span>
            )}
          </p>

          <div className="mt-6 flex flex-wrap items-center gap-2.5">
            {callElsewhere ? (
              <Button size="lg" disabled leadingIcon={<IconPhone size={18} />} aria-describedby="call-elsewhere-note">
                Start call
              </Button>
            ) : (
              <ButtonLink href="/call" size="lg" leadingIcon={<IconPhone size={18} />}>
                Start call
              </ButtonLink>
            )}
            <ButtonLink href="/chat" size="lg" variant="secondary" leadingIcon={<IconMessage size={18} />}>
              Open chat
            </ButtonLink>
          </div>
          {callElsewhere ? (
            <p id="call-elsewhere-note" className="mt-2.5 text-[13px] text-muted">
              A call is already in progress in another tab.
            </p>
          ) : null}
        </div>
        <RingMotif />
      </div>
    </Card>
  );
}

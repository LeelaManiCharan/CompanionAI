"use client";

import type { CheckIn } from "@/core/models";
import { Badge, Button, ButtonLink, Card, IconCheck, IconMessage, IconPhone, Skeleton } from "@/components/ui";
import { clockTime, zoneLabel } from "./format";

export type CheckInHeroCardProps = {
  botName: string;
  /** Preferred_Check_In_Time `HH:MM` in local time; undefined while loading or if it could not be read. */
  preferredTime: string | undefined;
  /** Today's record (null when none yet); undefined while loading. */
  today: CheckIn | null | undefined;
  loading: boolean;
  nowMs: number;
  /** A call is active in another tab; the Start call control is disabled. */
  callElsewhere: boolean;
};

function statusCopy(botName: string, time: string | undefined, today: CheckIn | null | undefined): string {
  if (today?.completedAt) return `You checked in at ${clockTime(today.completedAt)}. Nice work showing up for yourself.`;
  if (today?.snoozedUntil && !today.snoozeFiredAt) {
    return `Snoozed. ${botName} will remind you again at ${clockTime(today.snoozedUntil)}.`;
  }
  if (today) return `${botName} reached out at ${clockTime(today.triggeredAt)}. A short call or a few lines of chat both count.`;
  if (time) return `${botName} will check in around ${time}. You can start early whenever you like.`;
  return `Start a call or a chat whenever you're ready.`;
}

/** Concentric "dial" rings in accent green; purely decorative. */
function RingMotif() {
  return (
    <div aria-hidden="true" className="relative hidden size-[220px] shrink-0 md:block">
      <svg viewBox="0 0 220 220" className="absolute inset-0 size-full" fill="none">
        <circle cx="110" cy="110" r="108" stroke="var(--color-accent)" strokeWidth="1.5" />
        <circle cx="110" cy="110" r="84" stroke="var(--color-accent)" strokeWidth="1.5" />
        <circle cx="110" cy="110" r="60" fill="var(--color-accent)" />
        <circle cx="110" cy="110" r="108" stroke="var(--color-primary)" strokeOpacity="0.18" strokeWidth="1" strokeDasharray="2 6" />
      </svg>
      <span className="absolute left-1/2 top-1/2 flex size-[72px] -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-white shadow-card">
        <IconPhone size={28} />
      </span>
    </div>
  );
}

/** Home hero: today's Daily_Check_In status, preferred time, and the primary call / chat controls (3.1, 3.2, 3.5). */
export function CheckInHeroCard({ botName, preferredTime, today, loading, nowMs, callElsewhere }: CheckInHeroCardProps) {
  const completed = Boolean(today?.completedAt);
  const zone = zoneLabel(nowMs);

  return (
    <Card as="section" aria-labelledby="checkin-heading" className="relative overflow-hidden">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-primary" />
      <div className="flex items-center justify-between gap-8 p-6 sm:p-8 sm:pl-9">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-3">
            <h2
              id="checkin-heading"
              className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted"
            >
              Today&apos;s check-in
            </h2>
            {loading && today === undefined ? (
              <Skeleton className="h-[22px] w-24" />
            ) : completed ? (
              <Badge tone="green" icon={<IconCheck size={12} strokeWidth={2.25} />}>
                Completed
              </Badge>
            ) : (
              <Badge tone="neutral" dot>
                Not yet
              </Badge>
            )}
          </div>

          <div className="mt-5">
            {loading && preferredTime === undefined ? (
              <Skeleton className="h-12 w-36" />
            ) : (
              <p className="flex items-baseline gap-3">
                <span className="font-mono text-[44px] font-medium leading-none tracking-[-0.04em] text-text tabular-nums">
                  {preferredTime ?? "--:--"}
                </span>
                <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">
                  Preferred time{zone ? ` · ${zone}` : ""}
                </span>
              </p>
            )}
          </div>

          <p className="mt-4 max-w-md text-[15px] leading-6 text-muted">{statusCopy(botName, preferredTime, today)}</p>

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

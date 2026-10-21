"use client";

import { useState, useSyncExternalStore } from "react";
import { useCheckInPrompt } from "@/services/useScheduler";
import { reminderCallUrl } from "@/services/notifications";
import { completeReminder } from "@/services/reminderService";
import { isRinging, stopRingtone, subscribeRingtone } from "@/services/ringtone";
import { Button, ButtonLink, IconPhone, IconX } from "@/components/ui";

const notRinging = () => false;

export interface CheckInPromptBannerProps {
  callElsewhere: boolean;
  /** Only show reminder calls (used by pages other than Home, 24.6). */
  reminderOnly?: boolean;
  className?: string;
}

/**
 * In-app call prompt: the Daily_Check_In (12.6, 12.10, 13.5) with Answer,
 * Snooze 30 min (once per day), Dismiss; or a fired reminder (24.6) with
 * Answer and Dismiss.
 */
export function CheckInPromptBanner({ callElsewhere, reminderOnly = false, className = "mb-6" }: CheckInPromptBannerProps) {
  const { prompt, dismiss, snooze } = useCheckInPrompt();
  const ringing = useSyncExternalStore(subscribeRingtone, isRinging, notRinging);
  const [snoozing, setSnoozing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!prompt || (reminderOnly && prompt.kind !== "reminder")) return null;

  const isReminder = prompt.kind === "reminder";
  const href = isReminder ? reminderCallUrl(prompt.reminderId) : "/call";

  async function onSnooze() {
    stopRingtone();
    setSnoozing(true);
    setError(null);
    const res = await snooze();
    setSnoozing(false);
    if (!res.ok) setError(res.error);
  }

  function onDismiss() {
    stopRingtone();
    if (prompt?.kind === "reminder") void completeReminder(prompt.reminderId);
    dismiss();
  }

  function onAnswer() {
    stopRingtone();
    dismiss();
  }

  return (
    <section
      role="status"
      aria-label={isReminder ? "Reminder call" : "Check-in reminder"}
      data-ringing={ringing || undefined}
      className={`${className} flex flex-col gap-4 rounded-lg border px-5 py-4 sm:flex-row sm:items-center ${
        ringing ? "border-primary-deep/40 bg-accent shadow-card" : "border-primary/25 bg-accent"
      }`}
    >
      <span
        aria-hidden="true"
        className="relative flex size-11 shrink-0 items-center justify-center rounded-full bg-primary-deep text-white"
      >
        {/* Pulses; the global prefers-reduced-motion rule also stills it. */}
        <span
          className={`absolute inset-0 rounded-full border-2 border-primary-deep motion-reduce:hidden ${
            ringing ? "animate-ring-strong" : "animate-ring-soft"
          }`}
        />
        <span className={ringing ? "inline-flex motion-safe:animate-phone-ring" : "inline-flex"}>
          <IconPhone size={18} />
        </span>
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-5 tracking-[-0.01em] text-primary-deep">
          {isReminder ? `${prompt.botName} is calling — Reminder: ${prompt.text}` : `${prompt.botName} is calling. Want to check in?`}
        </p>
        <p className="mt-0.5 text-sm text-primary-deep/75">
          {error ??
            (isReminder
              ? "You asked to be reminded. Answer to hear it."
              : "Just a few minutes to share how your day is going.")}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {callElsewhere ? (
          <Button disabled leadingIcon={<IconPhone size={16} />}>
            Answer
          </Button>
        ) : (
          <ButtonLink href={href} leadingIcon={<IconPhone size={16} />} onClick={onAnswer}>
            Answer
          </ButtonLink>
        )}
        {prompt.kind === "checkin" && prompt.canSnooze ? (
          <Button variant="secondary" loading={snoozing} onClick={onSnooze}>
            Snooze 30 min
          </Button>
        ) : null}
        <Button variant="ghost" onClick={onDismiss} leadingIcon={<IconX size={14} />}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}

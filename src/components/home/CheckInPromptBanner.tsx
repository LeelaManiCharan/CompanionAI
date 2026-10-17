"use client";

import { useState } from "react";
import { useCheckInPrompt } from "@/services/useScheduler";
import { Button, ButtonLink, IconPhone, IconX } from "@/components/ui";

/** In-app Daily_Check_In prompt (12.6, 12.10, 13.5): Answer, Snooze 30 min (once per day), Dismiss. */
export function CheckInPromptBanner({ callElsewhere }: { callElsewhere: boolean }) {
  const { prompt, dismiss, snooze } = useCheckInPrompt();
  const [snoozing, setSnoozing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!prompt) return null;

  async function onSnooze() {
    setSnoozing(true);
    setError(null);
    const res = await snooze();
    setSnoozing(false);
    if (!res.ok) setError(res.error);
  }

  return (
    <section
      role="status"
      aria-label="Check-in reminder"
      className="mb-6 flex flex-col gap-4 rounded-lg border border-primary/25 bg-accent px-5 py-4 sm:flex-row sm:items-center"
    >
      <span
        aria-hidden="true"
        className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-white"
      >
        <span className="absolute inset-0 animate-ring-soft rounded-full border-2 border-primary" />
        <IconPhone size={18} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold leading-5 tracking-[-0.01em] text-primary-deep">
          {prompt.botName} is calling. Want to check in?
        </p>
        <p className="mt-0.5 text-sm text-primary-deep/75">
          {error ?? "Just a few minutes to share how your day is going."}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {callElsewhere ? (
          <Button disabled leadingIcon={<IconPhone size={16} />}>
            Answer
          </Button>
        ) : (
          <ButtonLink href="/call" leadingIcon={<IconPhone size={16} />} onClick={dismiss}>
            Answer
          </ButtonLink>
        )}
        {prompt.canSnooze ? (
          <Button variant="secondary" loading={snoozing} onClick={onSnooze}>
            Snooze 30 min
          </Button>
        ) : null}
        <Button variant="ghost" onClick={dismiss} leadingIcon={<IconX size={14} />}>
          Dismiss
        </Button>
      </div>
    </section>
  );
}

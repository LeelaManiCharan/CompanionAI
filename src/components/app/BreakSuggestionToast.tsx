"use client";

import { useSyncExternalStore } from "react";
import { IconX } from "@/components/ui";
import {
  dismissBreakSuggestion,
  getActivityTrackerState,
  getServerActivityTrackerState,
  subscribeActivityTracker,
} from "@/services/activityTracker";

/**
 * Break suggestion (15.5): a quiet, non-blocking card shown once per day after
 * 2 hours of use. It never covers the page and goes away when dismissed.
 */
export function BreakSuggestionToast() {
  const { breakSuggestion } = useSyncExternalStore(
    subscribeActivityTracker,
    getActivityTrackerState,
    getServerActivityTrackerState,
  );

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4 sm:justify-start sm:p-6"
    >
      {breakSuggestion ? (
        <div className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-start gap-3 rounded-md border border-border bg-bg px-4 py-3.5 shadow-[0_4px_16px_rgb(17_24_20/0.08)]">
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-medium leading-5 text-text">Time for a short break?</p>
            <p className="mt-0.5 leading-5 text-muted">
              You&apos;ve spent over 2 hours here today. A stretch, some water, or a message to a friend can help.
            </p>
          </div>
          <button
            type="button"
            onClick={dismissBreakSuggestion}
            aria-label="Dismiss break suggestion"
            className="-m-1 inline-flex size-7 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface hover:text-text"
          >
            <IconX size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}

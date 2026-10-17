"use client";

import { useEffect, useId, useRef } from "react";
import { buttonClasses, IconLifeBuoy, IconMessage, IconPhone, IconX } from "@/components/ui";
import { cn } from "@/lib/cn";

export type CrisisPanelProps = {
  open: boolean;
  onDismiss: () => void;
  /** Bumped each time the panel is (re)shown, so focus moves to it again. */
  showCount: number;
};

/**
 * Crisis_Resources (14.2, 14.7, 14.9, 20.30). Non-modal `alertdialog`: the page
 * underneath stays usable and nothing navigates or clears. It only goes away
 * when the user dismisses it.
 */
export function CrisisPanel({ open, onDismiss, showCount }: CrisisPanelProps) {
  const titleId = useId();
  const descId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    if (active instanceof HTMLElement && !panelRef.current?.contains(active)) returnFocusRef.current = active;
    panelRef.current?.focus();
  }, [open, showCount]);

  const dismiss = () => {
    onDismiss();
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target && document.contains(target)) target.focus();
  };

  if (!open) return null;

  return (
    <div
      ref={panelRef}
      role="alertdialog"
      aria-modal="false"
      aria-labelledby={titleId}
      aria-describedby={descId}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          dismiss();
        }
      }}
      className={cn(
        "fixed inset-x-3 top-3 z-[60] animate-dialog-in sm:inset-x-auto sm:right-5 sm:top-[68px] sm:w-[400px]",
        "rounded-lg border border-danger/25 bg-bg text-text shadow-[0_12px_32px_rgb(17_24_20/0.16)]",
        "focus-visible:outline-offset-4",
      )}
    >
      <div className="flex items-start gap-3 px-5 pt-5">
        <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-danger/[0.07] text-danger">
          <IconLifeBuoy size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-[17px] font-semibold leading-6 tracking-[-0.02em]">
            You don&apos;t have to go through this alone
          </h2>
          <p id={descId} className="mt-1 text-sm leading-5 text-muted">
            If you&apos;re thinking about hurting yourself, please reach out to a person now. Free, confidential, 24/7.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss crisis resources"
          className="-mr-2 -mt-1 inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-surface hover:text-text"
        >
          <IconX size={16} />
        </button>
      </div>

      <ul className="mt-4 flex flex-col gap-2 px-5">
        <li className="rounded-md border border-border bg-bg-subtle px-4 py-3.5">
          <p className="text-[15px] font-semibold leading-6 text-text">
            Call or text 988 <span className="font-normal text-muted">—</span> 988 Suicide &amp; Crisis Lifeline
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <a href="tel:988" className={buttonClasses({ variant: "primary" })}>
              <IconPhone size={16} />
              Call 988
            </a>
            <a href="sms:988" className={buttonClasses({ variant: "secondary" })}>
              <IconMessage size={16} />
              Text 988
            </a>
          </div>
        </li>
        <li className="rounded-md border border-danger/20 bg-danger/[0.03] px-4 py-3.5">
          <p className="text-[15px] font-semibold leading-6 text-text">Call 911 if you&apos;re in immediate danger</p>
          <div className="mt-3">
            <a href="tel:911" className={buttonClasses({ variant: "danger" })}>
              <IconPhone size={16} />
              Call 911
            </a>
          </div>
        </li>
      </ul>

      <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-4">
        <p className="text-[13px] leading-5 text-muted">Your companion is an AI and can&apos;t contact anyone for you.</p>
        <button
          type="button"
          onClick={dismiss}
          className={buttonClasses({ variant: "ghost", className: "-mr-2" })}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

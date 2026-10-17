"use client";

import { useEffect, useId, useRef, type ReactNode, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { IconButton } from "./IconButton";
import { IconX } from "./icons";

export type DialogProps = {
  open: boolean;
  /** Called on Escape, close button, backdrop click (if enabled). */
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  /** Footer actions, right-aligned. Put the primary action last. */
  actions?: ReactNode;
  size?: "sm" | "md" | "lg";
  /** Set false for blocking flows (Escape/backdrop/close button disabled). */
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  /** Element to focus on open. Defaults to the first focusable element. */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** Red title for destructive confirmations. */
  tone?: "default" | "danger";
  className?: string;
};

const widths = { sm: "max-w-sm", md: "max-w-md", lg: "max-w-xl" } as const;

/**
 * Native modal <dialog>. showModal() makes the rest of the page inert (focus
 * is contained), Escape is routed through onClose, and focus returns to the
 * element that was focused before opening.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  size = "md",
  dismissible = true,
  closeOnBackdrop = true,
  initialFocusRef,
  tone = "default",
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const openRef = useRef(open);
  const onCloseRef = useRef(onClose);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    openRef.current = open;
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      dialog.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocusRef]);

  // Restore focus if the dialog unmounts while open.
  useEffect(() => {
    const dialog = ref.current;
    return () => {
      if (dialog?.open) {
        dialog.close();
        returnFocusRef.current?.focus();
      }
    };
  }, []);

  const requestClose = () => {
    if (dismissible) onCloseRef.current();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        // Escape: keep React state as the source of truth.
        e.preventDefault();
        requestClose();
      }}
      onClose={() => {
        const target = returnFocusRef.current;
        returnFocusRef.current = null;
        if (target && document.contains(target)) target.focus();
        if (openRef.current) onCloseRef.current();
      }}
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) requestClose();
      }}
      className={cn(
        "m-auto w-[calc(100%-2rem)] overflow-visible bg-transparent p-0 text-text",
        "backdrop:bg-[rgb(17_24_20/0.45)] open:animate-dialog-in",
        widths[size],
      )}
    >
      <div className={cn("rounded-lg border border-border bg-bg shadow-[0_8px_24px_rgb(17_24_20/0.12)]", className)}>
        <div className="flex items-start justify-between gap-4 px-5 pt-5">
          <div className="min-w-0">
            <h2
              id={titleId}
              className={cn("text-[17px] font-semibold leading-6 tracking-[-0.02em]", tone === "danger" && "text-danger")}
            >
              {title}
            </h2>
            {description ? (
              <p id={descId} className="mt-1 text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <IconButton
              aria-label="Close dialog"
              icon={<IconX size={16} />}
              onClick={requestClose}
              className="-mr-2 -mt-1"
            />
          ) : null}
        </div>
        {children ? <div className="px-5 pt-4 text-[15px]">{children}</div> : null}
        {actions ? (
          <div className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5 pt-5">{actions}</div>
        ) : (
          <div className="pb-5" />
        )}
      </div>
    </dialog>
  );
}

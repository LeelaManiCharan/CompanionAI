"use client";

import { forwardRef, useId, type ReactNode, type TextareaHTMLAttributes } from "react";
import { IconAlert, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";

export type CountedTextareaProps = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "maxLength" | "value"> & {
  label: ReactNode;
  hideLabel?: boolean;
  value: string;
  /** Character limit shown in the counter. Not enforced natively, so over-limit edits can be rejected with an error and kept. */
  max: number;
  hint?: ReactNode;
  error?: ReactNode;
};

/**
 * Textarea with a live mono counter that keeps typing past the limit
 * possible (unlike `maxLength`), so the save can be rejected with an error
 * while the user's text stays in the editor (8.7, 9.8).
 */
export const CountedTextarea = forwardRef<HTMLTextAreaElement, CountedTextareaProps>(function CountedTextarea(
  { label, hideLabel, value, max, hint, error, id, className, ...rest },
  ref,
) {
  const autoId = useId();
  const controlId = id ?? `counted-${autoId}`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const countId = `${controlId}-count`;

  const length = value.length;
  const remaining = max - length;
  const over = remaining < 0;
  const near = remaining <= Math.max(10, Math.floor(max * 0.1));
  const describedBy = [error ? errorId : null, hint ? hintId : null, countId].filter(Boolean).join(" ");

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={controlId} className={cn("text-sm font-medium text-text", hideLabel && "sr-only")}>
        {label}
      </label>
      <Textarea
        ref={ref}
        id={controlId}
        value={value}
        aria-describedby={describedBy}
        aria-invalid={Boolean(error) || over || undefined}
        {...rest}
      />
      <div className="flex items-start justify-between gap-3 text-[13px] leading-5">
        <div className="flex min-w-0 flex-col gap-0.5">
          {error ? (
            <p id={errorId} className="flex items-start gap-1.5 font-medium text-danger">
              <IconAlert size={14} className="mt-[3px] shrink-0" />
              <span>{error}</span>
            </p>
          ) : null}
          {hint ? (
            <p id={hintId} className="text-muted">
              {hint}
            </p>
          ) : null}
        </div>
        <span
          id={countId}
          className={cn(
            "shrink-0 font-mono text-[12px] tabular-nums",
            over ? "font-medium text-danger" : near ? "text-text" : "text-muted",
          )}
        >
          {length.toLocaleString("en-US")}/{max.toLocaleString("en-US")}
        </span>
        <span className="sr-only" aria-live="polite">
          {over
            ? `${Math.abs(remaining).toLocaleString("en-US")} characters over the limit`
            : near
              ? `${remaining} characters remaining`
              : ""}
        </span>
      </div>
    </div>
  );
});

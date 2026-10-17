"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { cn } from "@/lib/cn";
import { IconAlert } from "./icons";

type Count = { length: number; max: number };

type FieldContextValue = {
  controlId: string;
  describedBy: string | undefined;
  invalid: boolean;
  required: boolean;
  reportCount: (c: Count | null) => void;
};

const FieldContext = createContext<FieldContextValue | null>(null);

export type FieldProps = {
  label: ReactNode;
  hint?: ReactNode;
  /** Error message. When present the control is marked aria-invalid. */
  error?: ReactNode;
  required?: boolean;
  /** Shows a quiet "Optional" tag next to the label. */
  optional?: boolean;
  /** Visually hide the label (still announced). */
  hideLabel?: boolean;
  /** Override the generated control id. */
  id?: string;
  className?: string;
  children: ReactNode;
};

/**
 * Label + control + hint/error + live counter. Wrap a TextInput, Textarea,
 * or Select; the control picks up id, aria-describedby and aria-invalid.
 */
export function Field({ label, hint, error, required = false, optional, hideLabel, id, className, children }: FieldProps) {
  const autoId = useId();
  const controlId = id ?? `field-${autoId}`;
  const hintId = `${controlId}-hint`;
  const errorId = `${controlId}-error`;
  const counterId = `${controlId}-count`;
  const [count, setCount] = useState<Count | null>(null);

  const reportCount = useCallback((c: Count | null) => {
    setCount((prev) => (prev?.length === c?.length && prev?.max === c?.max ? prev : c));
  }, []);

  const describedBy =
    [hint ? hintId : null, error ? errorId : null, count ? counterId : null].filter(Boolean).join(" ") || undefined;

  const ctx = useMemo<FieldContextValue>(
    () => ({ controlId, describedBy, invalid: Boolean(error), required, reportCount }),
    [controlId, describedBy, error, required, reportCount],
  );

  const showFooter = Boolean(hint || error || count);

  return (
    <FieldContext.Provider value={ctx}>
      <div className={cn("flex flex-col gap-1.5", className)}>
        <label
          htmlFor={controlId}
          className={cn("flex items-center gap-2 text-sm font-medium text-text", hideLabel && "sr-only")}
        >
          <span>
            {label}
            {required ? (
              <span aria-hidden="true" className="ml-0.5 text-muted">
                *
              </span>
            ) : null}
          </span>
          {optional && !required ? (
            <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Optional</span>
          ) : null}
        </label>
        {children}
        {showFooter ? (
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
            {count ? <CharCounter id={counterId} {...count} /> : null}
          </div>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}

function CharCounter({ id, length, max }: Count & { id: string }) {
  const remaining = max - length;
  const near = remaining <= Math.max(10, Math.floor(max * 0.1));
  const over = remaining <= 0;
  return (
    <>
      <span
        id={id}
        className={cn(
          "shrink-0 font-mono text-[12px] tabular-nums",
          over ? "text-danger" : near ? "text-text" : "text-muted",
        )}
      >
        {length.toLocaleString("en-US")}/{max.toLocaleString("en-US")}
      </span>
      {/* Announce only when close to the limit, so typing isn't noisy. */}
      <span className="sr-only" aria-live="polite">
        {near ? (over ? "Character limit reached" : `${remaining} characters remaining`) : ""}
      </span>
    </>
  );
}

/** Internal: resolve id/aria props and report the live count to the Field. */
export function useFieldControl(opts: {
  id?: string;
  maxLength?: number;
  length: number;
  ariaDescribedBy?: string;
  ariaInvalid?: boolean | "true" | "false";
  required?: boolean;
}) {
  const ctx = useContext(FieldContext);
  const fallbackId = useId();
  const { maxLength, length } = opts;
  const report = ctx?.reportCount;

  useEffect(() => {
    if (!report) return;
    report(maxLength && maxLength > 0 ? { length, max: maxLength } : null);
  }, [report, maxLength, length]);

  useEffect(() => {
    if (!report) return;
    return () => report(null);
  }, [report]);

  const describedBy = [ctx?.describedBy, opts.ariaDescribedBy].filter(Boolean).join(" ") || undefined;
  const invalid = opts.ariaInvalid === true || opts.ariaInvalid === "true" || Boolean(ctx?.invalid);

  return {
    id: opts.id ?? ctx?.controlId ?? fallbackId,
    "aria-describedby": describedBy,
    "aria-invalid": invalid || undefined,
    required: opts.required ?? (ctx?.required || undefined),
  };
}

/** Shared control surface styles (inputs, textareas, selects). */
export const controlClasses =
  "w-full rounded-md border border-border bg-bg text-[15px] text-text shadow-card transition-colors duration-150 " +
  "placeholder:text-muted/70 hover:border-muted/60 " +
  "focus-visible:border-primary " +
  "disabled:cursor-not-allowed disabled:bg-bg-subtle disabled:text-muted " +
  "aria-invalid:border-danger aria-invalid:focus-visible:outline-danger";

"use client";

import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef, type FormEvent, type KeyboardEvent } from "react";
import { IconSend, Spinner } from "@/components/ui";
import { LIMITS } from "@/core/validators";
import { cn } from "@/lib/cn";

const MAX = LIMITS.messageText.max;
/** Auto-grow cap before the textarea scrolls. */
const MAX_HEIGHT_PX = 220;

export type ComposerHandle = { focus: () => void };

export type ComposerProps = {
  value: string;
  onChange: (value: string) => void;
  /** Called with the text as typed (not trimmed). Only fires when sending is allowed. */
  onSubmit: (text: string) => void;
  /** A reply is pending: keep typing allowed but block submit (4.3). */
  pending?: boolean;
  /** Storage is read-only/unavailable, or another hard block. */
  disabled?: boolean;
  /** Shown under the input when `disabled`. */
  disabledReason?: string;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
};

/**
 * Auto-growing message input. Enter sends, Shift+Enter adds a newline. The
 * browser stops input at 4,000 characters and a mono counter shows the count
 * (4.6, 4.9).
 */
export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { value, onChange, onSubmit, pending = false, disabled = false, disabledReason, placeholder, autoFocus, className },
  ref,
) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const counterId = `${id}-count`;
  const hintId = `${id}-hint`;

  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }), []);

  // Grow with content up to a cap.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_HEIGHT_PX)}px`;
    el.style.overflowY = el.scrollHeight > MAX_HEIGHT_PX ? "auto" : "hidden";
  }, [value]);

  const blank = value.trim().length === 0;
  const canSend = !blank && !pending && !disabled && value.length <= MAX;
  const remaining = MAX - value.length;
  const near = remaining <= 200;

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    if (canSend) onSubmit(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.altKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <form onSubmit={submit} className={cn("w-full", className)} aria-label="Send a message">
      <div
        className={cn(
          "flex items-end gap-2 rounded-[14px] border border-border bg-bg p-1.5 pl-3.5 shadow-card",
          "transition-all duration-200 focus-within:border-primary/60 focus-within:shadow-glow hover:border-primary/30",
          disabled && "bg-bg-subtle",
        )}
      >
        <label htmlFor={id} className="sr-only">
          Message
        </label>
        <textarea
          ref={textareaRef}
          id={id}
          rows={1}
          value={value}
          maxLength={MAX}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder ?? "Write a message"}
          aria-describedby={`${counterId} ${hintId}`}
          onChange={(e) => onChange(e.currentTarget.value)}
          onKeyDown={onKeyDown}
          className={cn(
            "block max-h-[220px] min-h-[40px] flex-1 resize-none bg-transparent py-2 text-[15px] leading-6 text-text",
            "placeholder:text-muted/70 focus:outline-none focus-visible:outline-none disabled:cursor-not-allowed disabled:text-muted",
          )}
        />
        <button
          type="submit"
          disabled={!canSend}
          aria-label={pending ? "Waiting for reply" : "Send message"}
          title={pending ? "Waiting for reply" : "Send (Enter)"}
          className={cn(
            "inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] border transition-all duration-200 active:scale-95",
            "border-transparent bg-gradient-brand text-white shadow-glow hover:brightness-[1.06]",
            "disabled:border-border disabled:bg-none disabled:bg-surface disabled:text-muted disabled:shadow-none disabled:brightness-100",
          )}
        >
          {pending ? <Spinner size={16} /> : <IconSend size={17} />}
        </button>
      </div>

      <div className="mt-1.5 flex items-center justify-between gap-3 px-1">
        <p id={hintId} className="text-[12px] leading-5 text-muted">
          {disabled && disabledReason ? (
            disabledReason
          ) : (
            <>
              <kbd className="font-mono text-[11px]">Enter</kbd> to send ·{" "}
              <kbd className="font-mono text-[11px]">Shift+Enter</kbd> for a new line
            </>
          )}
        </p>
        <span
          id={counterId}
          className={cn(
            "shrink-0 font-mono text-[11px] tabular-nums",
            remaining <= 0 ? "text-danger" : near ? "text-text" : "text-muted",
          )}
        >
          <span className="sr-only">Characters used: </span>
          {value.length.toLocaleString("en-US")}/{MAX.toLocaleString("en-US")}
        </span>
        <span className="sr-only" aria-live="polite">
          {near ? (remaining <= 0 ? "Character limit reached" : `${remaining} characters remaining`) : ""}
        </span>
      </div>
    </form>
  );
});

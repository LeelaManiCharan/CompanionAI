"use client";

import { forwardRef, useState } from "react";
import { TextInput, type TextInputProps } from "@/components/ui";

export type PasswordInputProps = Omit<TextInputProps, "type" | "trailing">;

/** Password field with a keyboard-operable Show/Hide toggle. */
export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { className, ...rest },
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <TextInput
      ref={ref}
      type={visible ? "text" : "password"}
      spellCheck={false}
      autoCapitalize="none"
      // `!` beats TextInput's own `pr-10` (cn does no conflict merging).
      className={className ? `pr-16! ${className}` : "pr-16!"}
      trailing={
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-pressed={visible}
          aria-label={visible ? "Hide password" : "Show password"}
          className="inline-flex h-8 min-w-12 items-center justify-center rounded-sm px-2 text-[12px] font-medium text-muted transition-colors hover:bg-surface hover:text-text"
        >
          {visible ? "Hide" : "Show"}
        </button>
      }
      {...rest}
    />
  );
});

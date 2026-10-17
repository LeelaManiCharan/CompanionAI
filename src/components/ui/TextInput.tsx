"use client";

import { forwardRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import { controlClasses, useFieldControl } from "./Field";

export type TextInputProps = InputHTMLAttributes<HTMLInputElement> & {
  /** Use Geist Mono (URLs, keys, IDs). */
  mono?: boolean;
  /** Icon or text shown inside the left edge. */
  leading?: ReactNode;
  /** Element shown inside the right edge (e.g. a reveal button). */
  trailing?: ReactNode;
};

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  {
    mono,
    leading,
    trailing,
    className,
    id,
    maxLength,
    value,
    defaultValue,
    onChange,
    required,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    type = "text",
    ...rest
  },
  ref,
) {
  const controlled = value !== undefined;
  const [innerLen, setInnerLen] = useState(() => String(defaultValue ?? "").length);
  const length = controlled ? String(value ?? "").length : innerLen;

  const a11y = useFieldControl({
    id,
    maxLength,
    length,
    ariaDescribedBy,
    ariaInvalid: ariaInvalid as boolean | "true" | "false" | undefined,
    required,
  });

  const input = (
    <input
      ref={ref}
      type={type}
      maxLength={maxLength}
      value={value}
      defaultValue={defaultValue}
      onChange={(e) => {
        if (!controlled) setInnerLen(e.currentTarget.value.length);
        onChange?.(e);
      }}
      className={cn(
        controlClasses,
        "h-10 px-3",
        mono && "font-mono text-[14px]",
        leading ? "pl-9" : null,
        trailing ? "pr-10" : null,
        className,
      )}
      {...a11y}
      {...rest}
    />
  );

  if (!leading && !trailing) return input;
  return (
    <div className="relative">
      {leading ? (
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-muted">{leading}</span>
      ) : null}
      {input}
      {trailing ? <span className="absolute inset-y-0 right-1 flex items-center">{trailing}</span> : null}
    </div>
  );
});

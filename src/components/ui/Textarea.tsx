"use client";

import { forwardRef, useState, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { controlClasses, useFieldControl } from "./Field";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Allow vertical resizing (default true). */
  resizable?: boolean;
};

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  {
    resizable = true,
    className,
    id,
    maxLength,
    value,
    defaultValue,
    onChange,
    required,
    rows = 4,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
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

  return (
    <textarea
      ref={ref}
      rows={rows}
      maxLength={maxLength}
      value={value}
      defaultValue={defaultValue}
      onChange={(e) => {
        if (!controlled) setInnerLen(e.currentTarget.value.length);
        onChange?.(e);
      }}
      className={cn(
        controlClasses,
        "min-h-20 px-3 py-2 leading-6",
        resizable ? "resize-y" : "resize-none",
        className,
      )}
      {...a11y}
      {...rest}
    />
  );
});

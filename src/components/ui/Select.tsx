"use client";

import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { controlClasses, useFieldControl } from "./Field";

export type SelectOption = { value: string; label: string; disabled?: boolean };

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  /** Convenience: render options from data instead of children. */
  options?: SelectOption[];
};

/** Native <select> with the shared control styling and a custom chevron. */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    options,
    className,
    id,
    required,
    children,
    "aria-describedby": ariaDescribedBy,
    "aria-invalid": ariaInvalid,
    ...rest
  },
  ref,
) {
  const a11y = useFieldControl({
    id,
    length: 0,
    ariaDescribedBy,
    ariaInvalid: ariaInvalid as boolean | "true" | "false" | undefined,
    required,
  });

  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(controlClasses, "h-10 cursor-pointer appearance-none pl-3 pr-9", className)}
        {...a11y}
        {...rest}
      >
        {options
          ? options.map((o) => (
              <option key={o.value} value={o.value} disabled={o.disabled}>
                {o.label}
              </option>
            ))
          : children}
      </select>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 24 24"
        width="16"
        height="16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  );
});

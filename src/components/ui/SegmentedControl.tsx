"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SegmentedOption<T extends string> = {
  value: T;
  label: ReactNode;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  /** Group label (visible unless hideLabel). */
  label: ReactNode;
  hideLabel?: boolean;
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  name?: string;
  disabled?: boolean;
  size?: "sm" | "lg";
  fullWidth?: boolean;
  className?: string;
};

/**
 * Radio group styled as a segmented control. Uses native radios so arrow-key
 * navigation and form semantics come for free.
 */
export function SegmentedControl<T extends string>({
  label,
  hideLabel,
  options,
  value,
  onChange,
  name,
  disabled,
  size = "sm",
  fullWidth,
  className,
}: SegmentedControlProps<T>) {
  const autoId = useId();
  const groupName = name ?? `seg-${autoId}`;
  const labelId = `${groupName}-label`;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span id={labelId} className={cn("text-sm font-medium text-text", hideLabel && "sr-only")}>
        {label}
      </span>
      <div
        role="radiogroup"
        aria-labelledby={labelId}
        aria-disabled={disabled || undefined}
        className={cn(
          "inline-flex gap-0.5 rounded-md border border-border bg-surface p-0.5",
          fullWidth ? "flex w-full" : "w-fit",
        )}
      >
        {options.map((o) => {
          const selected = o.value === value;
          const optDisabled = disabled || o.disabled;
          return (
            <label
              key={o.value}
              className={cn(
                "relative inline-flex select-none items-center justify-center rounded-[5px] border font-medium transition-colors duration-150",
                "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-primary",
                size === "lg" ? "h-10 px-4 text-[15px]" : "h-8 px-3 text-sm",
                fullWidth && "flex-1",
                selected
                  ? "border-border bg-bg text-text shadow-card"
                  : "border-transparent text-muted hover:text-text",
                optDisabled ? "cursor-not-allowed opacity-50" : "cursor-pointer",
              )}
            >
              <input
                type="radio"
                name={groupName}
                value={o.value}
                checked={selected}
                disabled={optDisabled}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SwitchProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange" | "role" | "aria-checked"> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** Visible label. If omitted, pass aria-label. */
  label?: ReactNode;
  description?: ReactNode;
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, onCheckedChange, label, description, disabled, id, className, onClick, ...rest },
  ref,
) {
  const autoId = useId();
  const switchId = id ?? `switch-${autoId}`;
  const labelId = `${switchId}-label`;
  const descId = `${switchId}-desc`;

  const control = (
    <button
      ref={ref}
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={label ? labelId : undefined}
      aria-describedby={description ? descId : undefined}
      disabled={disabled}
      onClick={(e) => {
        onClick?.(e);
        if (!e.defaultPrevented) onCheckedChange(!checked);
      }}
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 cursor-pointer items-center rounded-full border transition-all duration-200",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "border-transparent bg-gradient-brand shadow-glow" : "border-border bg-surface-2",
        !label && className,
      )}
      {...rest}
    >
      <span
        aria-hidden="true"
        className={cn(
          "pointer-events-none block size-[18px] rounded-full bg-white shadow-[0_1px_2px_rgb(17_24_20/0.2)] transition-transform duration-150",
          checked ? "translate-x-[18px]" : "translate-x-[2px]",
        )}
      />
    </button>
  );

  if (!label) return control;

  return (
    <div className={cn("flex items-start justify-between gap-4", className)}>
      <div className="min-w-0">
        {/* <button> is labelable, so clicking the label toggles natively. */}
        <label
          id={labelId}
          htmlFor={switchId}
          className={cn("block text-sm font-medium text-text", disabled ? "cursor-not-allowed" : "cursor-pointer")}
        >
          {label}
        </label>
        {description ? (
          <p id={descId} className="mt-0.5 text-[13px] leading-5 text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <div className="pt-px">{control}</div>
    </div>
  );
});

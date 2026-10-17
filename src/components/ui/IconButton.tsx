import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ButtonSize, ButtonVariant } from "./Button";

export type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label" | "children"> & {
  /** Required: icon-only controls need an accessible name. */
  "aria-label": string;
  icon: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
};

const variants: Record<ButtonVariant, string> = {
  primary: "border-primary bg-primary text-white hover:bg-primary-hover active:bg-primary-deep",
  secondary: "border-border bg-bg text-text shadow-card hover:bg-bg-subtle active:bg-surface",
  ghost: "border-transparent bg-transparent text-muted hover:bg-surface hover:text-text active:bg-surface-2",
  danger: "border-danger bg-danger text-white hover:brightness-95 active:brightness-90",
};

const sizes: Record<ButtonSize, string> = {
  sm: "size-9",
  lg: "size-11",
};

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, variant = "ghost", size = "sm", className, type = "button", title, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      title={title ?? rest["aria-label"]}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md border transition-colors duration-150",
        "disabled:pointer-events-none disabled:opacity-50",
        variants[variant],
        sizes[size],
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
});

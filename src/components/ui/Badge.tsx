import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "green" | "danger";

const tones: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface text-muted",
  green: "border-primary/20 bg-accent text-primary-deep",
  danger: "border-danger/25 bg-danger/[0.06] text-danger",
};

const dots: Record<BadgeTone, string> = {
  neutral: "bg-muted",
  green: "bg-primary",
  danger: "bg-danger",
};

export type BadgeProps = HTMLAttributes<HTMLSpanElement> & {
  tone?: BadgeTone;
  /** Small leading status dot. */
  dot?: boolean;
  icon?: ReactNode;
};

export function Badge({ tone = "neutral", dot, icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-sm border px-2",
        "font-mono text-[11px] font-medium uppercase leading-none tracking-[0.06em]",
        tones[tone],
        className,
      )}
      {...rest}
    >
      {dot ? <span aria-hidden="true" className={cn("size-1.5 rounded-full", dots[tone])} /> : null}
      {icon}
      {children}
    </span>
  );
}

import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  /** Render N stacked text lines (last one shorter). */
  lines?: number;
};

/** Decorative placeholder. Pair with an aria-busy container or sr-only "Loading" text. */
const shimmer =
  "relative overflow-hidden bg-surface-2/60 before:absolute before:inset-0 before:-translate-x-full " +
  "before:animate-shimmer before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent";

export function Skeleton({ lines, className, ...rest }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div aria-hidden="true" className={cn("flex flex-col gap-2", className)} {...rest}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={cn("h-3.5 rounded-sm", shimmer, i === lines - 1 ? "w-3/5" : "w-full")} />
        ))}
      </div>
    );
  }
  return <div aria-hidden="true" className={cn("h-4 rounded-sm", shimmer, className)} {...rest} />;
}

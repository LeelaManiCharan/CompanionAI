import type { HTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type SkeletonProps = HTMLAttributes<HTMLDivElement> & {
  /** Render N stacked text lines (last one shorter). */
  lines?: number;
};

/** Decorative placeholder. Pair with an aria-busy container or sr-only "Loading" text. */
export function Skeleton({ lines, className, ...rest }: SkeletonProps) {
  if (lines && lines > 1) {
    return (
      <div aria-hidden="true" className={cn("flex flex-col gap-2", className)} {...rest}>
        {Array.from({ length: lines }, (_, i) => (
          <div
            key={i}
            className={cn("h-3.5 animate-pulse rounded-sm bg-surface-2/70", i === lines - 1 ? "w-3/5" : "w-full")}
          />
        ))}
      </div>
    );
  }
  return <div aria-hidden="true" className={cn("h-4 animate-pulse rounded-sm bg-surface-2/70", className)} {...rest} />;
}

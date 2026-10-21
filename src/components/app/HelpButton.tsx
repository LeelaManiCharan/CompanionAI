"use client";

import { IconLifeBuoy } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useSafety } from "./SafetyProvider";

export type HelpButtonProps = {
  /** `dark` for the full-screen call view. */
  tone?: "light" | "dark";
  className?: string;
};

/** Help control (14.5): opens the Crisis_Resources. Works with mouse, touch, and keyboard. */
export function HelpButton({ tone = "light", className }: HelpButtonProps) {
  const { showCrisis, crisisOpen } = useSafety();
  return (
    <button
      type="button"
      onClick={showCrisis}
      aria-haspopup="dialog"
      aria-expanded={crisisOpen}
      aria-label="Help: show crisis resources"
      title="Help and crisis resources"
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-sm font-medium tracking-[-0.01em] transition-all duration-200",
        tone === "light"
          ? "border-border bg-bg text-text shadow-card hover:border-danger/30 hover:bg-bg-subtle active:bg-surface"
          : "border-white/30 bg-white/5 text-white hover:bg-white/10 focus-visible:outline-white",
        className,
      )}
    >
      <IconLifeBuoy size={17} className={tone === "light" ? "text-danger" : "text-white"} />
      <span>Help</span>
    </button>
  );
}

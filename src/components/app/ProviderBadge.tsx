"use client";

import { Badge, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/cn";
import { providerBadgeLabel, type ActiveProviderState } from "@/services/modelRouter";
import { useProviderState } from "@/services/useProviderState";

const TONE: Record<ActiveProviderState["id"], BadgeTone> = {
  ollama: "green",
  gemini: "neutral",
  none: "danger",
};

const SHORT: Record<ActiveProviderState["id"], string> = {
  ollama: "Ollama",
  gemini: "Gemini",
  none: "No model",
};

export type ProviderBadgeProps = {
  /** `dark` for the call screen. */
  tone?: "light" | "dark";
  /** Always show the full label, even on narrow screens. */
  full?: boolean;
  className?: string;
};

/**
 * Provider_Badge (6.7, 6.8, 6.17): names the Active_Provider, including the
 * auto-mode fallback wording. Re-renders as soon as the router publishes.
 */
export function ProviderBadge({ tone = "light", full = false, className }: ProviderBadgeProps) {
  const state = useProviderState();
  const label = providerBadgeLabel(state);

  const content = full ? (
    label
  ) : (
    <>
      <span className="hidden sm:inline">{label}</span>
      <span className="sm:hidden">{SHORT[state.id]}</span>
    </>
  );

  if (tone === "dark") {
    return (
      <span
        role="status"
        title={`Model: ${label}`}
        className={cn(
          "inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-sm border border-white/25 bg-white/5 px-2",
          "font-mono text-[11px] font-medium uppercase leading-none tracking-[0.06em] text-white/90",
          className,
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full",
            state.id === "ollama" ? "bg-[#86efac]" : state.id === "gemini" ? "bg-white/60" : "bg-[#fca5a5]",
          )}
        />
        <span className="sr-only">Model: </span>
        {content}
      </span>
    );
  }

  return (
    <Badge role="status" tone={TONE[state.id]} dot title={`Model: ${label}`} className={className}>
      <span className="sr-only">Model: </span>
      {content}
    </Badge>
  );
}

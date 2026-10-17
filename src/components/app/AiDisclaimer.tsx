"use client";

import { DEFAULT_BOT_NAME } from "@/core/validators";
import { cn } from "@/lib/cn";
import { useOptionalApp } from "./appContext";

/** Persistent, non-dismissible AI disclaimer (15.3). Uses the Bot_Name when available. */
export function AiDisclaimer({ className }: { className?: string }) {
  const botName = useOptionalApp()?.settings?.botName ?? DEFAULT_BOT_NAME;
  return (
    <p className={cn("text-[13px] leading-5 text-muted", className)}>
      {botName} is an AI companion, not a therapist or a substitute for professional help.
    </p>
  );
}

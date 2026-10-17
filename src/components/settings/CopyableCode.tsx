"use client";

import { useEffect, useRef, useState } from "react";
import { Button, IconCheck } from "@/components/ui";
import { cn } from "@/lib/cn";

function IconCopy({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 5.5V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8.5a2 2 0 0 0 2 2h.5" />
    </svg>
  );
}

async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to the legacy path
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

export type CopyButtonProps = {
  text: string;
  /** Accessible name, e.g. "Copy namespace ID". */
  label?: string;
  className?: string;
  disabled?: boolean;
};

/** Small secondary button that copies `text` and confirms for 1.5 s. */
export function CopyButton({ text, label = "Copy", className, disabled }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const onClick = async () => {
    const ok = await writeClipboard(text);
    setState(ok ? "copied" : "failed");
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), 1500);
  };

  return (
    <Button
      variant="secondary"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn("h-8 px-2.5 text-[13px]", className)}
      leadingIcon={state === "copied" ? <IconCheck size={15} className="text-primary" /> : <IconCopy />}
    >
      <span aria-live="polite">{state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}</span>
    </Button>
  );
}

export type CopyableCodeProps = {
  code: string;
  label?: string;
  className?: string;
};

/** Mono code line with a copy control (OLLAMA_ORIGINS hint, `ollama pull`, ids). */
export function CopyableCode({ code, label, className }: CopyableCodeProps) {
  return (
    <div
      className={cn(
        "flex items-center gap-2 rounded-md border border-border bg-bg py-1.5 pl-3 pr-1.5 shadow-card",
        className,
      )}
    >
      <code className="min-w-0 flex-1 break-all font-mono text-[13px] leading-5 text-text">{code}</code>
      <CopyButton text={code} label={label ?? `Copy ${code}`} />
    </div>
  );
}

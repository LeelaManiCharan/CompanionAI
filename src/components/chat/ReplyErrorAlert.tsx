"use client";

import { useEffect, useState } from "react";
import { Button, ButtonLink, IconCheck, InlineAlert } from "@/components/ui";
import type { ReplyError } from "@/services/chatService";
import { ollamaOriginsHint, ollamaPullCommand } from "@/services/modelRouter";

/** Mono command block with a copy button (6.12, 6.13, 6.20). */
export function CommandBlock({ command, label }: { command: string; label: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1800);
    return () => window.clearTimeout(t);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
    } catch {
      /* clipboard can be blocked; the text stays selectable */
    }
  };

  return (
    <div className="mt-2.5 flex items-stretch overflow-hidden rounded-md border border-border bg-bg">
      <code
        aria-label={label}
        className="min-w-0 flex-1 select-all overflow-x-auto whitespace-pre px-3 py-2 font-mono text-[12.5px] leading-5 text-text"
      >
        {command}
      </code>
      <button
        type="button"
        onClick={copy}
        className="inline-flex shrink-0 items-center gap-1.5 border-l border-border bg-bg-subtle px-3 font-mono text-[11px] uppercase tracking-[0.06em] text-muted transition-colors hover:bg-surface hover:text-text"
      >
        {copied ? <IconCheck size={13} className="text-primary" /> : null}
        {copied ? "Copied" : "Copy"}
        <span className="sr-only"> command</span>
      </button>
    </div>
  );
}

function titleFor(error: ReplyError, saved: boolean): string {
  if (!saved) return "Your message was not sent";
  const info = error.providerError;
  if (!info) return "The reply failed";
  switch (info.kind) {
    case "unreachable":
      return "Ollama could not be reached";
    case "model_not_installed":
      return "That Ollama model isn't installed";
    case "timeout":
      return info.provider === "ollama" ? "Ollama didn't respond in time" : "Gemini didn't respond in time";
    case "busy":
      return "Taking a short breather";
    case "unavailable":
      return info.reason === "offline" ? "You're offline" : "The hosted model isn't available";
    case "unauthorized":
      return "Session expired";
    case "notice_declined":
      return "A reply needs your OK";
    case "no_model":
      return "No model is available";
    case "upstream":
      return info.provider === "ollama" ? "Ollama returned an error" : "Gemini returned an error";
  }
}

export type ReplyErrorAlertProps = {
  error: ReplyError;
  /** Whether the user Message was stored (false: the text is back in the input). */
  saved: boolean;
  onRetry?: () => void;
  retrying?: boolean;
  onDismiss: () => void;
};

/**
 * Inline failure for a send or reply (4.7, 4.8, 6.11–6.13, 6.18–6.20, 6.22).
 * Provider-specific wording comes from the service; Ollama setup commands are
 * shown in mono with a copy button.
 */
export function ReplyErrorAlert({ error, saved, onRetry, retrying = false, onDismiss }: ReplyErrorAlertProps) {
  const info = error.providerError;
  const showOrigins = info?.kind === "unreachable" || info?.kind === "no_model";
  const pullModel = info?.kind === "model_not_installed" ? info.model : null;
  const loginLink = info?.kind === "unauthorized";
  const settingsLink =
    info !== undefined &&
    info.kind !== "timeout" &&
    info.kind !== "upstream" &&
    info.kind !== "busy" &&
    info.kind !== "unauthorized";

  return (
    <InlineAlert
      tone="danger"
      title={titleFor(error, saved)}
      onDismiss={onDismiss}
      actions={
        onRetry || settingsLink || loginLink ? (
          <>
            {loginLink ? (
              <ButtonLink href="/login" size="sm" variant="secondary">
                Sign in again
              </ButtonLink>
            ) : null}
            {onRetry ? (
              <Button size="sm" variant="secondary" onClick={onRetry} loading={retrying}>
                Retry
              </Button>
            ) : null}
            {settingsLink ? (
              <ButtonLink href="/settings" size="sm" variant="ghost">
                Model settings
              </ButtonLink>
            ) : null}
          </>
        ) : undefined
      }
    >
      <p>{error.message}</p>
      {!saved ? <p className="mt-1 text-muted">Your text is still in the box below.</p> : null}
      {showOrigins ? (
        <>
          <p className="mt-2 text-[13px] text-muted">Set this environment variable for Ollama, then restart it:</p>
          <CommandBlock command={ollamaOriginsHint()} label="Ollama origins setting" />
        </>
      ) : null}
      {pullModel ? (
        <>
          <p className="mt-2 text-[13px] text-muted">Install it from a terminal:</p>
          <CommandBlock command={ollamaPullCommand(pullModel)} label="Ollama install command" />
        </>
      ) : null}
    </InlineAlert>
  );
}

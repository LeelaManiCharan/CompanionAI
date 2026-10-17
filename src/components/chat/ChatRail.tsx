"use client";

import Link from "next/link";
import { useActiveProfile, useCanWrite } from "@/components/app";
import { Button, ButtonLink, IconMessage, IconPhone, IconPlus, InlineAlert } from "@/components/ui";
import type { Chat } from "@/core/models";
import { useLiveQuery, useRepo } from "@/data/useLiveQuery";
import { cn } from "@/lib/cn";
import { relativeTime } from "./format";
import { useNow } from "./useNow";

export type ChatRailProps = {
  /** Highlighted chat. */
  activeChatId?: string | null;
  /** Called by "New chat" when provided; otherwise the button links to `/chat`. */
  onNewChat?: () => void;
  className?: string;
};

/** Left rail: New chat + the Active_Profile's chats, most recently updated first. */
export function ChatRail({ activeChatId = null, onNewChat, className }: ChatRailProps) {
  const profile = useActiveProfile();
  const canWrite = useCanWrite();
  const repo = useRepo();
  const now = useNow();

  const chats = useLiveQuery<Chat[]>(
    async () => (repo ? repo.listChats(profile.id) : []),
    ["chats"],
    [repo, profile.id],
  );

  const list = chats.data ?? [];

  return (
    <aside aria-label="Your chats" className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex items-center justify-between gap-3 pb-3">
        <h2 className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Chats</h2>
        {onNewChat ? (
          <Button size="sm" leadingIcon={<IconPlus size={16} />} onClick={onNewChat} disabled={!canWrite}>
            New chat
          </Button>
        ) : (
          <ButtonLink href="/chat" size="sm" leadingIcon={<IconPlus size={16} />}>
            New chat
          </ButtonLink>
        )}
      </div>

      {chats.error && !chats.data ? (
        <InlineAlert tone="danger" title="Chats could not be loaded">
          Your stored chats were not changed. Try reloading the page.
        </InlineAlert>
      ) : chats.loading && !chats.data ? (
        <div className="flex flex-col gap-2" aria-busy="true">
          <span className="sr-only">Loading chats</span>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} aria-hidden="true" className="h-14 w-full animate-pulse rounded-md bg-surface-2/60" />
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-subtle px-4 py-6 text-center">
          <p className="text-sm font-medium text-text">No conversations yet</p>
          <p className="mt-1 text-[13px] leading-5 text-muted">Your chats and calls will show up here.</p>
        </div>
      ) : (
        <ul className="-mx-1 flex flex-col gap-0.5 overflow-y-auto px-1 pb-1">
          {list.map((chat) => {
            const active = chat.id === activeChatId;
            const voice = chat.mode === "voice";
            return (
              <li key={chat.id}>
                <Link
                  href={`/chat/${chat.id}`}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "group relative flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors duration-150",
                    active
                      ? "border-primary/20 bg-accent"
                      : "border-transparent hover:bg-surface",
                  )}
                >
                  {active ? (
                    <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" />
                  ) : null}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md border",
                      active ? "border-primary/20 bg-bg text-primary" : "border-border bg-bg text-muted group-hover:text-text",
                    )}
                  >
                    {voice ? <IconPhone size={14} /> : <IconMessage size={14} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span
                        className={cn(
                          "truncate text-sm tracking-[-0.01em]",
                          active ? "font-semibold text-primary-deep" : "font-medium text-text",
                          !chat.title && "italic text-muted",
                        )}
                      >
                        {chat.title || "Untitled chat"}
                      </span>
                      <time
                        dateTime={chat.updatedAt}
                        className="shrink-0 font-mono text-[11px] tabular-nums text-muted"
                      >
                        {relativeTime(chat.updatedAt, now)}
                      </time>
                    </span>
                    <span className="mt-0.5 block font-mono text-[10.5px] uppercase tracking-[0.06em] text-muted">
                      {voice ? "Voice call" : "Text chat"}
                    </span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

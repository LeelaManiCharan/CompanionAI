"use client";

import Link from "next/link";
import type { HomeChatItem } from "@/core/selectors";
import {
  Badge,
  ButtonLink,
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  IconChevronLeft,
  IconMessage,
  IconMic,
  Skeleton,
} from "@/components/ui";
import { fullDateTime, relativeTime } from "./format";

export type RecentChatsCardProps = {
  botName: string;
  items: HomeChatItem[] | undefined;
  loading: boolean;
  /** True when the Chats could not be read (the page shows the alert). */
  failed: boolean;
  nowMs: number;
};

function ChatRow({
  item,
  nowMs,
  botName,
  main,
}: {
  item: HomeChatItem;
  nowMs: number;
  botName: string;
  /** The ongoing conversation (most recent Chat). */
  main: boolean;
}) {
  const { chat, lastMessageAt } = item;
  const voice = chat.mode === "voice";
  const title = chat.title.trim() || `Chat with ${botName}`;
  return (
    <li>
      <Link
        href={`/chat/${encodeURIComponent(chat.id)}`}
        className="group flex items-center gap-3.5 px-5 py-3 transition-colors hover:bg-bg-subtle focus-visible:bg-bg-subtle focus-visible:outline-offset-[-2px]"
      >
        <span
          aria-hidden="true"
          className={
            voice
              ? "flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-brand text-white shadow-glow"
              : "flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-muted"
          }
        >
          {voice ? <IconMic size={16} /> : <IconMessage size={16} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium tracking-[-0.01em] text-text">{title}</span>
          <span className="block text-[13px] text-muted">{main ? "Continue chat" : voice ? "Older voice call" : "Older chat"}</span>
        </span>
        <time
          dateTime={lastMessageAt}
          title={fullDateTime(lastMessageAt)}
          className="shrink-0 font-mono text-[12px] tabular-nums text-muted"
        >
          {relativeTime(lastMessageAt, nowMs)}
        </time>
        <IconChevronLeft
          size={16}
          className="shrink-0 rotate-180 text-muted/60 transition-transform group-hover:translate-x-0.5 group-hover:text-text"
        />
      </Link>
    </li>
  );
}

/** Up to 50 recent Chats, newest message first (3.3, 3.4). */
export function RecentChatsCard({ botName, items, loading, failed, nowMs }: RecentChatsCardProps) {
  const list = items ?? [];
  const count = list.length;
  return (
    <Card as="section" aria-labelledby="recent-heading" className="flex flex-col">
      <CardHeader
        actions={
          <ButtonLink
            href={list[0] ? `/chat/${encodeURIComponent(list[0].chat.id)}` : "/chat"}
            variant="ghost"
            leadingIcon={<IconMessage size={16} />}
          >
            Continue chat
          </ButtonLink>
        }
      >
        <div className="flex items-center gap-2.5">
          <CardTitle id="recent-heading">Recent conversations</CardTitle>
          {count > 0 ? <Badge>{count}</Badge> : null}
        </div>
        <CardDescription>Calls and chats with {botName}, most recent first.</CardDescription>
      </CardHeader>

      {loading && items === undefined && !failed ? (
        <div aria-busy="true" className="divide-y divide-border">
          <span className="sr-only">Loading conversations</span>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex items-center gap-3.5 px-5 py-3.5">
              <Skeleton className="size-9 rounded-md" />
              <div className="flex-1">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="mt-2 h-3 w-1/5" />
              </div>
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      ) : count > 0 ? (
        <ul className="divide-y divide-border" aria-label="Recent conversations">
          {list.map((item, i) => (
            <ChatRow key={item.chat.id} item={item} nowMs={nowMs} botName={botName} main={i === 0} />
          ))}
        </ul>
      ) : (
        <div className="p-5">
          <EmptyState
            icon={<IconMessage size={18} />}
            title={failed ? "Conversations unavailable" : "No conversations yet"}
            description={
              failed
                ? "Your conversations couldn't be loaded right now. You can still start a new one."
                : `When you talk with ${botName}, your calls and chats will show up here.`
            }
            actions={
              <ButtonLink href="/chat" variant="secondary" leadingIcon={<IconMessage size={16} />}>
                Start a chat
              </ButtonLink>
            }
          />
        </div>
      )}
    </Card>
  );
}

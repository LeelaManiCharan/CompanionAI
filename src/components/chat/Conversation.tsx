"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useActiveProfile, useCanWrite, useSettings } from "@/components/app";
import {
  Badge,
  Button,
  ButtonLink,
  Dialog,
  EmptyState,
  IconButton,
  IconChevronLeft,
  IconMessage,
  IconPhone,
  IconTrash,
  InlineAlert,
  Spinner,
  useToast,
} from "@/components/ui";
import type { Chat, Message } from "@/core/models";
import { useLiveQuery, useRepo } from "@/data/useLiveQuery";
import { deleteChat } from "@/services/chatDeletion";
import { isCallActive } from "@/services/chatService";
import { ComposerDock } from "./ChatLayout";
import { Composer, type ComposerHandle } from "./Composer";
import { clockTime, dayKey, dayLabel } from "./format";
import { MessageBubble, TypingIndicator } from "./MessageBubble";
import { ReplyErrorAlert } from "./ReplyErrorAlert";
import { consumeRestoreText, dismissSendError, startRetry, startSend, useChatSend } from "./sendStore";
import { useNow } from "./useNow";

/** Messages shown per window; "Load earlier" adds another page (design: 500-message window). */
export const MESSAGE_PAGE = 500;

type Window = { messages: Message[]; hasEarlier: boolean };

/** Groups voice Messages by call; older voice Messages without a callId group per Chat. Null for text. */
function callKey(m: Message | undefined): string | null {
  if (!m || m.channel !== "voice") return null;
  return m.callId ?? `legacy:${m.chatId}`;
}

/** First and last Message time of each call in the window. */
function spansByCall(messages: Message[]): Map<string, { start: number; end: number }> {
  const spans = new Map<string, { start: number; end: number }>();
  for (const m of messages) {
    const key = callKey(m);
    if (key === null) continue;
    const t = Date.parse(m.createdAt);
    const cur = spans.get(key);
    if (!cur) spans.set(key, { start: t, end: t });
    else spans.set(key, { start: Math.min(cur.start, t), end: Math.max(cur.end, t) });
  }
  return spans;
}

/** "< 1 min", "2 min", "1 h 5 min". */
function callDuration(start: number, end: number): string {
  const mins = Math.round((end - start) / 60_000);
  if (mins < 1) return "< 1 min";
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const rest = mins % 60;
  return rest === 0 ? `${h} h` : `${h} h ${rest} min`;
}

function CallDivider({ children }: { children: ReactNode }) {
  return (
    <li className="my-4 flex items-center gap-3">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="inline-flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted">
        <IconPhone size={11} aria-hidden="true" />
        {children}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </li>
  );
}

/**
 * `/chat/[id]`: header, message list, typing indicator, errors with retry,
 * composer, delete. Render with `key={chatId}` so switching chats resets state.
 */
export function Conversation({ chatId }: { chatId: string }) {
  const router = useRouter();
  const repo = useRepo();
  const profile = useActiveProfile();
  const settings = useSettings();
  const canWrite = useCanWrite();
  const { toast } = useToast();
  const now = useNow();
  const botName = settings.botName;

  const send = useChatSend(chatId);
  const [text, setText] = useState("");
  const composerRef = useRef<ComposerHandle>(null);

  const [pages, setPages] = useState(1);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deletedRef = useRef(false);

  const chatQ = useLiveQuery<Chat | null>(
    async () => {
      if (!repo) return null;
      const c = await repo.getChat(chatId);
      return c && c.profileId === profile.id ? c : null;
    },
    ["chats"],
    [repo, chatId, profile.id],
  );

  // Latest `pages * 500` Messages, oldest first; one extra row tells us whether earlier ones exist.
  const limit = pages * MESSAGE_PAGE;
  const msgQ = useLiveQuery<Window>(
    async () => {
      if (!repo) return { messages: [], hasEarlier: false };
      const rows = await repo.messagesByChat(chatId, { limit: limit + 1 });
      return rows.length > limit
        ? { messages: rows.slice(rows.length - limit), hasEarlier: true }
        : { messages: rows, hasEarlier: false };
    },
    ["messages", "chats"],
    [repo, chatId, limit],
  );

  const chat = chatQ.data;
  const messages = msgQ.data?.messages ?? [];
  const hasEarlier = msgQ.data?.hasEarlier ?? false;

  // Put unsaved text back in the input (4.8); only if the user hasn't typed something new.
  useEffect(() => {
    if (send.restoreText === null) return;
    const restored = send.restoreText;
    setText((cur) => (cur === "" ? restored : cur));
    consumeRestoreText(chatId);
  }, [send.restoreText, chatId]);

  // ---------------------------------------------------------------------------
  // Scrolling: stick to the bottom on new messages; keep position on "Load earlier".
  // ---------------------------------------------------------------------------

  const anchorRef = useRef<{ height: number; y: number } | null>(null);
  const lastIdRef = useRef<string | null>(null);
  const initialRef = useRef(true);
  const lastId = messages.length > 0 ? messages[messages.length - 1].id : null;

  useLayoutEffect(() => {
    if (msgQ.loading && !msgQ.data) return;
    const root = document.documentElement;
    const anchor = anchorRef.current;
    if (anchor) {
      anchorRef.current = null;
      window.scrollTo({ top: anchor.y + (root.scrollHeight - anchor.height), behavior: "instant" });
      lastIdRef.current = lastId;
      return;
    }
    if (lastIdRef.current !== lastId || send.pending || send.error) {
      const first = initialRef.current;
      initialRef.current = false;
      lastIdRef.current = lastId;
      window.scrollTo({ top: root.scrollHeight, behavior: first ? "instant" : "smooth" });
    }
  }, [lastId, send.pending, send.error, msgQ.loading, msgQ.data]);

  const loadEarlier = () => {
    anchorRef.current = { height: document.documentElement.scrollHeight, y: window.scrollY };
    setPages((p) => p + 1);
  };

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  const submit = (value: string) => {
    setText("");
    void startSend(chatId, value);
  };

  const onRetry = send.retryMessageId
    ? () => {
        const id = send.retryMessageId;
        if (id) void startRetry(chatId, id);
      }
    : undefined;

  const confirmDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    const res = await deleteChat(chatId);
    if (!res.ok) {
      setDeleting(false);
      setDeleteError(res.error);
      return;
    }
    deletedRef.current = true;
    setConfirmOpen(false);
    setDeleting(false);
    toast({ title: "Chat deleted", description: `${botName} forgot what was learned only from it.`, tone: "success" });
    router.push("/chat");
  };

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const backLink = (
    <Link
      href="/chat"
      className="-ml-2 inline-flex h-8 items-center gap-1 self-start rounded-md px-2 text-sm text-muted transition-colors hover:bg-surface hover:text-text lg:hidden"
    >
      <IconChevronLeft size={16} />
      All chats
    </Link>
  );

  if (chatQ.loading && chatQ.data === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center py-24" aria-busy="true">
        <Spinner size={20} label="Loading chat" className="text-muted" />
      </div>
    );
  }

  if (chatQ.error && chatQ.data === undefined) {
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <InlineAlert tone="danger" title="This chat could not be loaded">
          Your stored messages were not changed. Try reloading the page.
        </InlineAlert>
      </div>
    );
  }

  if (!chat) {
    if (deletedRef.current) return null;
    return (
      <div className="flex flex-col gap-4">
        {backLink}
        <EmptyState
          as="h2"
          icon={<IconMessage size={18} />}
          title="This chat isn't here anymore"
          description="It may have been deleted, possibly in another tab. Your other chats are still in the list."
          actions={
            <ButtonLink href="/chat" variant="secondary" size="sm">
              Back to chats
            </ButtonLink>
          }
          className="py-16"
        />
      </div>
    );
  }

  const voice = chat.mode === "voice";
  const title = chat.title || `Chat with ${botName}`;
  const callActive = isCallActive(chatId);
  const callSpans = spansByCall(messages);

  return (
    <>
      <header className="flex flex-col gap-2 border-b border-border pb-4">
        {backLink}
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <h1
              className={
                chat.title
                  ? "truncate text-[20px] leading-7 tracking-[-0.025em] text-text"
                  : "truncate text-[20px] italic leading-7 tracking-[-0.025em] text-muted"
              }
            >
              {title}
            </h1>
            <div className="mt-1 flex items-center gap-2">
              <Badge tone={voice ? "green" : "neutral"} icon={voice ? <IconPhone size={11} /> : <IconMessage size={11} />}>
                {voice ? "Voice" : "Text"}
              </Badge>
              <span className="font-mono text-[11px] tabular-nums text-muted">
                {messages.length === 0
                  ? "No messages yet"
                  : `${hasEarlier ? `${messages.length.toLocaleString("en-US")}+` : messages.length.toLocaleString("en-US")} ${
                      messages.length === 1 && !hasEarlier ? "message" : "messages"
                    }`}
              </span>
            </div>
          </div>
          <ButtonLink href="/call" variant="secondary" size="sm" leadingIcon={<IconPhone size={16} />}>
            <span className="hidden sm:inline">Call {botName}</span>
            <span className="sm:hidden">Call</span>
          </ButtonLink>
          <IconButton
            aria-label="Delete chat"
            icon={<IconTrash size={17} />}
            disabled={!canWrite}
            onClick={() => {
              setDeleteError(null);
              setConfirmOpen(true);
            }}
            className="hover:text-danger"
          />
        </div>
      </header>

      <div className="flex-1 pt-6">
        {hasEarlier ? (
          <div className="mb-6 flex justify-center">
            <Button variant="secondary" size="sm" onClick={loadEarlier} loading={msgQ.loading}>
              Load earlier messages
            </Button>
          </div>
        ) : null}

        {msgQ.error && !msgQ.data ? (
          <InlineAlert tone="danger" title="Messages could not be loaded" className="mb-4">
            Your stored messages were not changed. Try reloading the page.
          </InlineAlert>
        ) : null}

        {messages.length === 0 && !send.pending && msgQ.data ? (
          <div className="flex flex-col items-center py-16 text-center">
            <p className="text-[15px] font-medium text-text">Say hello to {botName}</p>
            <p className="mt-1 text-sm text-muted">Your conversation will appear here.</p>
          </div>
        ) : null}

        <ol aria-label={`Conversation with ${botName}`} className="flex flex-col">
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            const nextNewDay = !next || dayKey(next.createdAt) !== dayKey(m.createdAt);
            const key = callKey(m);
            const callStart = key !== null && (!prev || callKey(prev) !== key);
            const callEnd = key !== null && (!next || callKey(next) !== key);
            const groupStart = newDay || callStart || prev.role !== m.role || callKey(prev) !== key;
            const groupEnd = nextNewDay || callEnd || next.role !== m.role || callKey(next) !== key;
            const span = key !== null ? callSpans.get(key) : undefined;
            return (
              <Fragment key={m.id}>
                {newDay ? (
                  <li aria-hidden="true" className="my-4 flex items-center gap-3 first:mt-0">
                    <span className="h-px flex-1 bg-border" />
                    <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.08em] text-muted">
                      {dayLabel(m.createdAt, now)}
                    </span>
                    <span className="h-px flex-1 bg-border" />
                  </li>
                ) : null}
                {callStart ? (
                  <CallDivider>
                    Voice call · {clockTime(m.createdAt)}
                    {span ? ` · ${callDuration(span.start, span.end)}` : ""}
                  </CallDivider>
                ) : null}
                <MessageBubble message={m} botName={botName} groupStart={groupStart} groupEnd={groupEnd} />
                {callEnd && !(callActive && i === messages.length - 1) ? <CallDivider>Call ended</CallDivider> : null}
              </Fragment>
            );
          })}
          {send.pending ? <TypingIndicator botName={botName} /> : null}
        </ol>

        {send.error && !send.pending ? (
          <div className="mb-2 sm:pl-[38px]">
            <ReplyErrorAlert
              error={send.error}
              saved={send.userSaved}
              onRetry={onRetry}
              onDismiss={() => dismissSendError(chatId)}
            />
          </div>
        ) : null}
      </div>

      <ComposerDock>
        <Composer
          ref={composerRef}
          value={text}
          onChange={setText}
          onSubmit={submit}
          pending={send.pending}
          disabled={!canWrite}
          disabledReason="Storage is unavailable, so new messages can't be saved right now."
          placeholder={`Message ${botName}`}
          autoFocus
        />
      </ComposerDock>

      <Dialog
        open={confirmOpen}
        onClose={() => {
          if (!deleting) setConfirmOpen(false);
        }}
        tone="danger"
        size="sm"
        title="Delete this chat?"
        description={`This deletes your whole conversation history with ${botName} and what was learned only from it.`}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleting} disabled={callActive}>
              Delete chat
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">
            “<span className="text-text">{title}</span>” and its messages will be removed from this device. This
            can&apos;t be undone.
          </p>
          {callActive ? (
            <InlineAlert tone="warning">End the call before deleting this chat.</InlineAlert>
          ) : null}
          {deleteError ? <InlineAlert tone="danger">{deleteError}</InlineAlert> : null}
        </div>
      </Dialog>
    </>
  );
}

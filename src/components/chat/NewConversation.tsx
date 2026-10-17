"use client";

import { useRouter } from "next/navigation";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useActiveProfile, useCanWrite, useSettings } from "@/components/app";
import { ButtonLink, IconChevronLeft, IconPhone, InlineAlert } from "@/components/ui";
import { createChat } from "@/services/chatService";
import { ComposerDock } from "./ChatLayout";
import { Composer, type ComposerHandle } from "./Composer";
import { BotAvatar } from "./MessageBubble";
import { startSend } from "./sendStore";

const STARTERS = [
  "Here's how my day went",
  "Something good happened today",
  "I could use a little encouragement",
  "Can we just chat for a bit?",
];

export type NewConversationProps = {
  /** Mobile only: return to the chat list. */
  onBack?: () => void;
};

/**
 * Empty state for `/chat` with a composer. The first send creates a text Chat
 * (4.5), hands the Message to the send store, and moves to `/chat/[id]`.
 */
export const NewConversation = forwardRef<ComposerHandle, NewConversationProps>(function NewConversation(
  { onBack },
  ref,
) {
  const router = useRouter();
  const profile = useActiveProfile();
  const settings = useSettings();
  const canWrite = useCanWrite();
  const composerRef = useRef<ComposerHandle>(null);
  const [text, setText] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useImperativeHandle(ref, () => ({ focus: () => composerRef.current?.focus() }), []);

  const submit = async (value: string) => {
    if (creating) return;
    setCreating(true);
    setError(null);
    const res = await createChat(profile.id, "text");
    if (!res.ok) {
      setError(res.error);
      setCreating(false);
      composerRef.current?.focus();
      return;
    }
    void startSend(res.value.id, value);
    router.replace(`/chat/${res.value.id}`);
  };

  const botName = settings.botName;

  return (
    <>
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="-ml-2 mb-4 inline-flex h-8 items-center gap-1 self-start rounded-md px-2 text-sm text-muted transition-colors hover:bg-surface hover:text-text lg:hidden"
        >
          <IconChevronLeft size={16} />
          All chats
        </button>
      ) : null}

      <div className="flex flex-1 flex-col items-center justify-center px-2 py-10 text-center sm:py-16">
        <div className="relative">
          <span aria-hidden="true" className="absolute -inset-2 rounded-full border border-primary/10" />
          <BotAvatar botName={botName} size="lg" />
        </div>
        <p className="mt-6 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted">New conversation</p>
        <h1 className="mt-2 text-[26px] leading-tight tracking-[-0.03em] text-text">
          Start a conversation with {botName}
        </h1>
        <p className="mt-2 max-w-md text-[15px] text-muted">
          Say how your day is going, or whatever is on your mind. {botName} remembers what matters to you, right here on
          this device.
        </p>

        <ul aria-label="Conversation starters" className="mt-7 flex max-w-lg flex-wrap justify-center gap-2">
          {STARTERS.map((s) => (
            <li key={s}>
              <button
                type="button"
                disabled={!canWrite || creating}
                onClick={() => {
                  setText(s);
                  composerRef.current?.focus();
                }}
                className="rounded-full border border-border bg-bg px-3.5 py-1.5 text-[13px] text-text shadow-card transition-colors duration-150 hover:border-primary/30 hover:bg-accent/60 disabled:pointer-events-none disabled:opacity-50"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>

        <div className="mt-6 flex items-center gap-2 text-[13px] text-muted">
          <span>Rather talk out loud?</span>
          <ButtonLink href="/call" size="sm" variant="ghost" leadingIcon={<IconPhone size={15} />}>
            Start a call
          </ButtonLink>
        </div>
      </div>

      <ComposerDock>
        {error ? (
          <InlineAlert tone="danger" title="The chat could not be started" onDismiss={() => setError(null)} className="mb-3">
            {error} Your text is still in the box below.
          </InlineAlert>
        ) : null}
        <Composer
          ref={composerRef}
          value={text}
          onChange={setText}
          onSubmit={submit}
          pending={creating}
          disabled={!canWrite}
          disabledReason="Storage is unavailable, so new messages can't be saved right now."
          placeholder={`Message ${botName}`}
        />
      </ComposerDock>
    </>
  );
});

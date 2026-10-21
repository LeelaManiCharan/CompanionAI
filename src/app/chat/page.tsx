"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useActiveProfile } from "@/components/app";
import { ChatLayout, NewConversation, type ComposerHandle } from "@/components/chat";
import { Spinner } from "@/components/ui";
import { useRepo } from "@/data/useLiveQuery";

/**
 * `/chat`: opens the Profile's ongoing conversation (its most recently
 * updated Chat). With no Chats yet, or with `?new=1` ("Start a separate
 * chat"), shows the new-conversation composer (Req 4.5).
 */
export default function ChatIndexPage() {
  const router = useRouter();
  const repo = useRepo();
  const profile = useActiveProfile();
  const [composing, setComposing] = useState(false);
  const [checking, setChecking] = useState(true);
  const composerRef = useRef<ComposerHandle>(null);

  useEffect(() => {
    if (!repo) return;
    let live = true;
    void (async () => {
      const separate = new URLSearchParams(window.location.search).has("new");
      const chats = separate ? [] : await repo.listChats(profile.id).catch(() => []);
      if (!live) return;
      if (chats[0]) {
        router.replace(`/chat/${chats[0].id}`);
        return;
      }
      setChecking(false);
      if (separate) setComposing(true);
    })();
    return () => {
      live = false;
    };
  }, [repo, profile.id, router]);

  const startNew = () => {
    setComposing(true);
    // Wait for the panel to be visible on mobile before focusing.
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <ChatLayout mobileView={composing || checking ? "conversation" : "rail"} rail={{ activeChatId: null, onNewChat: startNew }}>
      {checking ? (
        <div className="flex flex-1 items-center justify-center py-24" aria-busy="true">
          <Spinner size={20} label="Opening your conversation" className="text-muted" />
        </div>
      ) : (
        <NewConversation ref={composerRef} onBack={() => setComposing(false)} />
      )}
    </ChatLayout>
  );
}

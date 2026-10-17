"use client";

import { useRef, useState } from "react";
import { ChatLayout, NewConversation, type ComposerHandle } from "@/components/chat";

/** `/chat`: chat rail + new-conversation composer (Req 4.5). On mobile the list shows first. */
export default function ChatIndexPage() {
  const [composing, setComposing] = useState(false);
  const composerRef = useRef<ComposerHandle>(null);

  const startNew = () => {
    setComposing(true);
    // Wait for the panel to be visible on mobile before focusing.
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  return (
    <ChatLayout mobileView={composing ? "conversation" : "rail"} rail={{ activeChatId: null, onNewChat: startNew }}>
      <NewConversation ref={composerRef} onBack={() => setComposing(false)} />
    </ChatLayout>
  );
}

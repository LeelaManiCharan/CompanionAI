"use client";

import { useParams } from "next/navigation";
import { ChatLayout, Conversation } from "@/components/chat";

/** `/chat/[id]`: rail + conversation; conversation only on mobile (Req 4). */
export default function ChatPage() {
  const params = useParams<{ id: string }>();
  const id = typeof params?.id === "string" ? decodeURIComponent(params.id) : "";

  return (
    <ChatLayout mobileView="conversation" rail={{ activeChatId: id }}>
      <Conversation key={id} chatId={id} />
    </ChatLayout>
  );
}

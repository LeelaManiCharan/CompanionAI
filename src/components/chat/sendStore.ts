"use client";

/**
 * Per-chat send state shared across chat views (Req 4.1, 4.3, 4.7, 4.8).
 *
 * Lives at module level so a send started on `/chat` (new conversation) keeps
 * its typing indicator, error, and restored input after navigating to
 * `/chat/[id]`, and survives switching between chats in the rail.
 */
import { useSyncExternalStore } from "react";
import { retry, sendMessage, type ReplyError, type SendResult } from "@/services/chatService";

export interface ChatSendState {
  /** A reply (or the user Message save) is in flight. */
  pending: boolean;
  /** Last failure for this chat, shown as an inline alert. */
  error: ReplyError | null;
  /** Stored user Message to re-request a reply for; null when retry is not possible. */
  retryMessageId: string | null;
  /** Text to put back in the input because the user Message was not saved (4.8). */
  restoreText: string | null;
  /** Whether the user Message behind `error` was stored. */
  userSaved: boolean;
}

const EMPTY: ChatSendState = { pending: false, error: null, retryMessageId: null, restoreText: null, userSaved: true };
const UNEXPECTED: ReplyError = { message: "Something went wrong. Please try again.", retryable: false };

const states = new Map<string, ChatSendState>();
const listeners = new Set<() => void>();

function get(chatId: string): ChatSendState {
  return states.get(chatId) ?? EMPTY;
}

function update(chatId: string, patch: Partial<ChatSendState>): void {
  states.set(chatId, { ...get(chatId), ...patch });
  for (const l of [...listeners]) l();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

async function run(chatId: string, op: () => Promise<SendResult>, typedText: string | null): Promise<void> {
  update(chatId, { pending: true, error: null, retryMessageId: null, restoreText: null, userSaved: true });
  let result: SendResult;
  try {
    result = await op();
  } catch {
    result = { userMessage: null, flagged: false, error: UNEXPECTED };
  }

  if (!result.userMessage) {
    // Nothing was stored, so nothing can be retried; give the text back (4.8).
    update(chatId, {
      pending: false,
      error: result.error ?? UNEXPECTED,
      retryMessageId: null,
      restoreText: typedText,
      // A failed retry never un-saves the original Message.
      userSaved: typedText === null,
    });
    return;
  }

  if (result.error) {
    update(chatId, {
      pending: false,
      error: result.error,
      retryMessageId: result.error.retryable ? result.userMessage.id : null,
    });
    return;
  }

  update(chatId, { pending: false, error: null, retryMessageId: null });
}

/** Stores and sends a typed Message; the outcome lands in the chat's send state. */
export function startSend(chatId: string, text: string): Promise<void> {
  if (get(chatId).pending) return Promise.resolve();
  return run(chatId, () => sendMessage(chatId, text), text);
}

/** Re-requests a reply for an already-stored user Message (4.7). */
export function startRetry(chatId: string, userMessageId: string): Promise<void> {
  if (get(chatId).pending) return Promise.resolve();
  return run(chatId, () => retry(chatId, userMessageId), null);
}

export function dismissSendError(chatId: string): void {
  if (get(chatId).error) update(chatId, { error: null, retryMessageId: null });
}

/** Marks restored text as handled (it has been put back in the input). */
export function consumeRestoreText(chatId: string): void {
  if (get(chatId).restoreText !== null) update(chatId, { restoreText: null });
}

export function useChatSend(chatId: string): ChatSendState {
  return useSyncExternalStore(
    subscribe,
    () => get(chatId),
    () => EMPTY,
  );
}

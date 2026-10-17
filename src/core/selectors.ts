/**
 * Pure list selectors (Req 1.6, 1.8, 3.3, 4.4). Inputs are never mutated.
 * Ties are always broken by `id` (ascending, code-unit order) so results are
 * deterministic regardless of input order.
 */
import type { Chat, Message, Profile } from "./models";

/** Maximum number of Chats on the Home list (3.3). */
export const HOME_CHAT_LIMIT = 50;

const ms = (t: string): number => Date.parse(t);

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * Startup / post-deletion Active_Profile selection (1.6, 1.8): the Profile with
 * the latest `lastUsedAt`; ties go to the smallest `id`. Returns `null` for an
 * empty list.
 */
export function pickActiveProfile(profiles: readonly Profile[]): Profile | null {
  let best: Profile | null = null;
  for (const p of profiles) {
    if (best === null) {
      best = p;
      continue;
    }
    const diff = ms(p.lastUsedAt) - ms(best.lastUsedAt);
    if (diff > 0 || (diff === 0 && byId(p, best) < 0)) best = p;
  }
  return best;
}

export interface HomeChatItem {
  chat: Chat;
  /** Most recent Message `createdAt` in the Chat, or the Chat's `updatedAt` when it has none. */
  lastMessageAt: string;
}

/**
 * Home list (3.3): up to 50 of `profileId`'s Chats ordered by most recent
 * Message time descending (falling back to the Chat's `updatedAt` when it has
 * no Messages); ties by `id` ascending.
 */
export function homeChatList(
  chats: readonly Chat[],
  messages: readonly Message[],
  profileId: string,
): HomeChatItem[] {
  const latest = new Map<string, number>();
  for (const m of messages) {
    if (m.profileId !== profileId) continue;
    const t = ms(m.createdAt);
    const prev = latest.get(m.chatId);
    if (prev === undefined || t > prev) latest.set(m.chatId, t);
  }

  return chats
    .filter((c) => c.profileId === profileId)
    .map((chat) => {
      const t = latest.get(chat.id);
      return {
        chat,
        time: t ?? ms(chat.updatedAt),
        lastMessageAt: t === undefined ? chat.updatedAt : new Date(t).toISOString(),
      };
    })
    .sort((a, b) => b.time - a.time || byId(a.chat, b.chat))
    .slice(0, HOME_CHAT_LIMIT)
    .map(({ chat, lastMessageAt }) => ({ chat, lastMessageAt }));
}

/** Messages in ascending `createdAt` order, oldest first (4.4); ties by `id`. Returns a new array. */
export function sortMessages(messages: readonly Message[]): Message[] {
  return [...messages].sort((a, b) => ms(a.createdAt) - ms(b.createdAt) || byId(a, b));
}

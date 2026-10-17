/**
 * Chat deletion and Profile reset (Req 10.2–10.9, 20.9).
 *
 * `deleteChat` runs one readwrite transaction over chats, messages, memories,
 * summaries, and profileMeta: it deletes the Chat and its Messages, applies
 * `forgetChat`, clears the Profile_Summary to "", and sets `summaryStale`.
 * Any failure aborts the whole transaction, so nothing changes (10.8). After
 * commit the summary is regenerated from the remaining Memories (10.5); if
 * that fails it stays empty and is regenerated later (10.9).
 */
import { forgetChat } from "@/core/memory";
import { getRepo, initRepo, type Repo } from "@/data/repository";
import { getActiveCallChatId, isCallActive } from "./chatService";
import {
  assertOpCurrent,
  defaultProfileMeta,
  forgetQueuedForChat,
  forgetQueuedForProfile,
  regenerateSummary,
} from "./memoryService";
import type { ServiceResult } from "./profileService";
import { getActiveProfileId, opFor } from "./session";

export const DELETION_ERRORS = {
  callActive: "End the call before deleting this chat.",
  callActiveReset: "End the call before resetting this Profile.",
  notFound: "That chat no longer exists.",
  inactive: "This chat belongs to a Profile that is no longer active.",
  failed: "The deletion failed. Nothing was deleted, so you can try again.",
  resetFailed: "The reset failed. Nothing was deleted, so you can try again.",
  unavailable: "Local storage is unavailable, so nothing was deleted.",
} as const;

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
const fail = (error: string): ServiceResult<never> => ({ ok: false, error });

async function repo(): Promise<Repo> {
  return getRepo() ?? (await initRepo());
}

/** Deletes a Chat of the Active_Profile and forgets everything derived from it. */
export async function deleteChat(chatId: string): Promise<ServiceResult> {
  if (isCallActive(chatId)) return fail(DELETION_ERRORS.callActive); // 20.9
  const profileId = getActiveProfileId();
  if (!profileId) return fail(DELETION_ERRORS.inactive);
  const r = await repo();
  if (r.mode !== "ready") return fail(DELETION_ERRORS.unavailable);

  const op = opFor(profileId, chatId);
  let missing = false;
  let wrongProfile = false;
  const res = await r.tx(op, ["chats", "messages", "memories", "summaries", "profileMeta"], async (t) => {
    assertOpCurrent(op);
    const chat = await t.get("chats", chatId);
    if (!chat) {
      missing = true;
      throw new Error("missing");
    }
    if (chat.profileId !== profileId) {
      wrongProfile = true;
      throw new Error("wrong profile");
    }

    const messages = await t.getAllByIndex("messages", "byChat", chatId);
    const messageIds = new Set(messages.map((m) => m.id));
    const memories = await t.getAllByIndex("memories", "byProfile", profileId);
    const { deleteIds, updates } = forgetChat(memories, chatId, messageIds);

    // Memories first so no stored Memory ever references a deleted record (10.3, 10.4, 10.6).
    for (const id of deleteIds) await t.delete("memories", id);
    for (const m of updates) await t.put("memories", m);
    for (const m of messages) await t.delete("messages", m.id);
    await t.delete("chats", chatId);

    const now = new Date().toISOString();
    await t.put("summaries", { profileId, content: "", updatedAt: now });
    const meta = (await t.get("profileMeta", profileId)) ?? defaultProfileMeta(profileId, now);
    await t.put("profileMeta", { ...meta, summaryStale: true, updatedAt: now });
  });

  if (missing) return fail(DELETION_ERRORS.notFound);
  if (wrongProfile) return fail(DELETION_ERRORS.inactive);
  if (!res.ok) return fail(res.error.kind === "stale" ? DELETION_ERRORS.inactive : DELETION_ERRORS.failed);

  forgetQueuedForChat(chatId); // 10.10
  void regenerateSummary(profileId); // 10.5, 10.9
  return ok(undefined);
}

/**
 * Deletes all Chats, Messages, Memories, and the Profile_Summary content of a
 * Profile, keeping the Profile and its Settings (10.7).
 */
export async function resetProfile(profileId: string): Promise<ServiceResult> {
  const r = await repo();
  if (r.mode !== "ready") return fail(DELETION_ERRORS.unavailable);
  if (getActiveProfileId() !== profileId) return fail(DELETION_ERRORS.inactive);

  const callChat = getActiveCallChatId();
  if (callChat !== null) {
    const chat = await r.getChat(callChat).catch(() => undefined);
    if (!chat || chat.profileId === profileId) return fail(DELETION_ERRORS.callActiveReset);
  }

  const op = opFor(profileId);
  const res = await r.tx(op, ["chats", "messages", "memories", "summaries", "profileMeta"], async (t) => {
    assertOpCurrent(op);
    const memories = await t.getAllByIndex("memories", "byProfile", profileId);
    const messages = await t.getAllByIndex("messages", "byProfile", profileId);
    const chats = await t.getAllByIndex("chats", "byProfile", profileId);
    for (const m of memories) await t.delete("memories", m.id);
    for (const m of messages) await t.delete("messages", m.id);
    for (const c of chats) await t.delete("chats", c.id);

    const now = new Date().toISOString();
    await t.put("summaries", { profileId, content: "", updatedAt: now });
    const meta = (await t.get("profileMeta", profileId)) ?? defaultProfileMeta(profileId, now);
    await t.put("profileMeta", { ...meta, newMemoriesSinceSummary: 0, summaryStale: false, updatedAt: now });
  });
  if (!res.ok) return fail(res.error.kind === "stale" ? DELETION_ERRORS.inactive : DELETION_ERRORS.resetFailed);

  forgetQueuedForProfile(profileId);
  return ok(undefined);
}

/**
 * Chat_Service (Req 4, 14.1, 14.2, 14.8, 20.7–20.10, 20.24, 20.25).
 *
 * Send flow: validate → Safety_Monitor scan → store user Message → crisis
 * signal → build context → Model_Router → guarded companion write (Profile
 * still active, Chat still exists, epoch unchanged; else discard) → mark
 * today's check-in completed → enqueue memory extraction.
 */
import { buildContext } from "@/core/context";
import type { ProviderId } from "@/core/generation";
import type { Chat, ChatMode, Message, Settings } from "@/core/models";
import { CRISIS_FALLBACK_REPLY, detectCrisis } from "@/core/safety";
import { validateMessageText } from "@/core/validators";
import { getRepo, initRepo, type OperationContext, type Repo } from "@/data/repository";
import { markCheckInCompleted } from "./checkInCompletion";
import { assertOpCurrent, isOpCurrent, onReplyStored, StaleOperation } from "./memoryService";
import {
  isProviderError,
  modelRouter,
  providerErrorMessage,
  type ProviderErrorInfo,
} from "./modelRouter";
import type { ServiceResult } from "./profileService";
import { getActiveProfileId, opFor } from "./session";

/** Max stored Message length (19.4, 20.24). */
export const MESSAGE_CONTENT_MAX = 10_000;
/** Chat titles come from the first user Message, cut to this length. */
export const TITLE_MAX = 60;

export const CHAT_ERRORS = {
  unavailable: "Local storage is unavailable, so the message was not saved.",
  notSaved: "Your message was not saved. Please try again.",
  chatMissing: "This chat no longer exists.",
  inactive: "This chat belongs to a Profile that is no longer active.",
  createFailed: "The chat could not be created. Please try again.",
  emptyReply: "The companion sent an empty reply. Please try again.",
  replyFailed: "The reply failed. Please try again.",
  noSettings: "Settings for this Profile could not be loaded, so no reply was requested.",
  cancelled: "The reply was cancelled.",
} as const;

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
const fail = (error: string): ServiceResult<never> => ({ ok: false, error });

async function repo(): Promise<Repo> {
  return getRepo() ?? (await initRepo());
}

const nowIso = () => new Date().toISOString();
const laterOf = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);
/** A timestamp strictly after `after` (keeps reply ordering after its user Message). */
const strictlyAfter = (after: string): string =>
  new Date(Math.max(Date.now(), Date.parse(after) + 1)).toISOString();

const titleFrom = (text: string): string => text.trim().replace(/\s+/g, " ").slice(0, TITLE_MAX).trim();

// ---------------------------------------------------------------------------
// Crisis signal (14.2, 14.9)
// ---------------------------------------------------------------------------

export interface CrisisEvent {
  profileId: string;
  chatId: string;
  /** Null when the user Message could not be saved. */
  messageId: string | null;
}

type CrisisListener = (e: CrisisEvent) => void;
const crisisListeners = new Set<CrisisListener>();

/** The page-level SafetyProvider subscribes to show Crisis_Resources. */
export function onCrisis(listener: CrisisListener): () => void {
  crisisListeners.add(listener);
  return () => void crisisListeners.delete(listener);
}

function emitCrisis(e: CrisisEvent) {
  for (const l of [...crisisListeners]) {
    try {
      l(e);
    } catch {
      /* a broken listener must not block the chat */
    }
  }
}

// ---------------------------------------------------------------------------
// Active call tracking (20.9)
// ---------------------------------------------------------------------------

let activeCallChatId: string | null = null;

/** Set by the voice call controller when a call starts (chat id) and ends (null). */
export function setCallActive(chatId: string | null): void {
  activeCallChatId = chatId;
}

export function getActiveCallChatId(): string | null {
  return activeCallChatId;
}

export function isCallActive(chatId: string): boolean {
  return activeCallChatId !== null && activeCallChatId === chatId;
}

// ---------------------------------------------------------------------------
// Chats
// ---------------------------------------------------------------------------

/** Creates an empty Chat for the Active_Profile (4.5). */
export async function createChat(profileId: string, mode: ChatMode, title = ""): Promise<ServiceResult<Chat>> {
  if (getActiveProfileId() !== profileId) return fail(CHAT_ERRORS.inactive);
  const r = await repo();
  if (r.mode !== "ready") return fail(CHAT_ERRORS.unavailable);

  const now = nowIso();
  const chat: Chat = {
    id: crypto.randomUUID(),
    profileId,
    title: title.trim().slice(0, 100).trim(),
    mode,
    createdAt: now,
    updatedAt: now,
  };
  const op = opFor(profileId, chat.id);
  const res = await r.tx(op, ["chats"], async (t) => {
    assertOpCurrent(op);
    await t.put("chats", chat);
  });
  if (!res.ok) return fail(res.error.kind === "stale" ? CHAT_ERRORS.inactive : CHAT_ERRORS.createFailed);
  return ok(chat);
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface ReplyError {
  message: string;
  /** Whether a retry control should be shown (4.7). */
  retryable: boolean;
  providerError?: ProviderErrorInfo;
}

export interface SendResult {
  /** The stored user Message; null when it could not be saved (4.8). */
  userMessage: Message | null;
  /** The stored Companion reply (or the crisis fallback reply, 14.8). */
  reply?: Message;
  error?: ReplyError;
  /** The Safety_Monitor flagged the user Message (14.1). */
  flagged: boolean;
  /** The reply arrived after the Profile/Chat/epoch changed and was dropped (20.7, 20.10). */
  discarded?: boolean;
}

export interface SendOptions {
  signal?: AbortSignal;
}

type StoreOutcome =
  | { ok: true; message: Message }
  | { ok: false; kind: "stale" | "missing" | "failed" };

/** Resolves the operation context for a Chat of the Active_Profile. */
async function contextFor(r: Repo, chatId: string): Promise<{ op: OperationContext; chat: Chat } | { error: string }> {
  const profileId = getActiveProfileId();
  if (!profileId) return { error: CHAT_ERRORS.inactive };
  let chat: Chat | undefined;
  try {
    chat = await r.getChat(chatId);
  } catch {
    return { error: CHAT_ERRORS.notSaved };
  }
  if (!chat) return { error: CHAT_ERRORS.chatMissing };
  if (chat.profileId !== profileId) return { error: CHAT_ERRORS.inactive };
  return { op: opFor(profileId, chatId), chat };
}

/**
 * Writes a Message and bumps the Chat's `updatedAt` (and sets its title from
 * the first user Message) in one guarded transaction.
 */
async function storeMessage(
  r: Repo,
  op: OperationContext,
  chatId: string,
  role: Message["role"],
  content: string,
  safetyFlagged: boolean,
  createdAt: string,
): Promise<StoreOutcome> {
  let missing = false;
  const message: Message = {
    id: crypto.randomUUID(),
    chatId,
    profileId: op.profileId,
    role,
    content: content.slice(0, MESSAGE_CONTENT_MAX),
    createdAt,
    safetyFlagged,
  };
  const res = await r.tx(op, ["messages", "chats"], async (t) => {
    assertOpCurrent(op);
    const chat = await t.get("chats", chatId);
    if (!chat || chat.profileId !== op.profileId) {
      missing = true;
      throw new StaleOperation();
    }
    await t.put("messages", message);
    const title = chat.title === "" && role === "user" ? titleFrom(content) : chat.title;
    await t.put("chats", { ...chat, title, updatedAt: laterOf(createdAt, chat.createdAt) });
  });
  if (res.ok) return { ok: true, message };
  if (missing) return { ok: false, kind: "missing" };
  return { ok: false, kind: res.error.kind === "stale" ? "stale" : "failed" };
}

const isAbort = (err: unknown): boolean =>
  (err instanceof DOMException || err instanceof Error) && err.name === "AbortError";

/** Provider used for request trimming: trim for gemini unless the Profile is pinned to Ollama. */
function providerForContext(settings: Settings): ProviderId {
  if (settings.providerMode === "ollama") return "ollama";
  if (settings.providerMode === "gemini") return "gemini";
  return modelRouter.getState().id === "ollama" ? "ollama" : "gemini";
}

/**
 * Builds context, calls the Model_Router, and stores the reply for an
 * already-stored user Message. Shared by `sendMessage`, `retry`, and voice.
 */
async function generateReply(
  r: Repo,
  op: OperationContext,
  userMessage: Message,
  opts: SendOptions,
): Promise<SendResult> {
  const flagged = userMessage.safetyFlagged;
  const base: SendResult = { userMessage, flagged };
  const chatId = userMessage.chatId;

  const settings = await r.getSettings(op.profileId).catch(() => undefined);
  if (!settings) return { ...base, error: { message: CHAT_ERRORS.noSettings, retryable: true } };

  // 9.9: a failed read proceeds without that part of the context.
  const summary = await r
    .getSummary(op.profileId)
    .then((s) => s?.content ?? null)
    .catch(() => null);
  const memories = await r.memoriesByProfile(op.profileId).catch(() => []);
  const earlier = await r
    .messagesByChat(chatId, { before: userMessage.createdAt, limit: 19 })
    .catch(() => [] as Message[]);

  const req = buildContext({
    task: "reply",
    profileId: op.profileId,
    botName: settings.botName,
    tone: settings.tone,
    summary,
    memories,
    chatMessages: [...earlier, userMessage],
    latestUserText: userMessage.content,
    safetyFlagged: flagged,
    provider: providerForContext(settings),
  });

  let failure: ReplyError | null = null;
  let text = "";
  try {
    text = await modelRouter.generate(settings, req, { signal: opts.signal });
    if (text.trim().length === 0) failure = { message: CHAT_ERRORS.emptyReply, retryable: true }; // 20.25
  } catch (err) {
    if (isAbort(err)) return { ...base, error: { message: CHAT_ERRORS.cancelled, retryable: true } };
    failure = isProviderError(err)
      ? {
          message: providerErrorMessage(err, { baseUrl: settings.ollamaBaseUrl || undefined }),
          retryable: err.info.kind !== "notice_declined",
          providerError: err.info,
        }
      : { message: CHAT_ERRORS.replyFailed, retryable: true };
  }

  if (failure) {
    if (!flagged) return { ...base, error: failure };
    // 14.8: show the fallback supportive message in place of the reply.
    const stored = await storeMessage(
      r,
      op,
      chatId,
      "companion",
      CRISIS_FALLBACK_REPLY,
      false,
      strictlyAfter(userMessage.createdAt),
    );
    if (!stored.ok) return stored.kind === "failed" ? { ...base, error: failure } : { ...base, discarded: true };
    return { ...base, reply: stored.message, error: { ...failure, retryable: false } };
  }

  // 20.7, 20.10: discard replies for an inactive Profile, a deleted Chat, or an old epoch.
  if (!isOpCurrent(op)) return { ...base, discarded: true };
  const stored = await storeMessage(
    r,
    op,
    chatId,
    "companion",
    text.slice(0, MESSAGE_CONTENT_MAX), // 20.24
    false,
    strictlyAfter(userMessage.createdAt),
  );
  if (!stored.ok) {
    if (stored.kind === "failed") return { ...base, error: { message: CHAT_ERRORS.replyFailed, retryable: true } };
    return { ...base, discarded: true };
  }

  onReplyStored(op, chatId, userMessage.id); // fire-and-forget extraction (8.1, 8.5)
  return { ...base, reply: stored.message };
}

interface StoredUser {
  op: OperationContext;
  message: Message;
  flagged: boolean;
}

/** Scans, signals, and stores a user Message. */
async function storeUser(
  r: Repo,
  chatId: string,
  text: string,
): Promise<{ ok: true; value: StoredUser } | { ok: false; error: string; flagged: boolean }> {
  const ctx = await contextFor(r, chatId);
  // Scan before anything else so crisis UI can show even if saving fails (14.1, 14.2).
  const { flagged } = detectCrisis(text);
  if ("error" in ctx) {
    const active = getActiveProfileId();
    if (flagged && active) emitCrisis({ profileId: active, chatId, messageId: null });
    return { ok: false, error: ctx.error, flagged };
  }
  const { op } = ctx;

  const stored = await storeMessage(r, op, chatId, "user", text, flagged, nowIso());
  if (flagged) emitCrisis({ profileId: op.profileId, chatId, messageId: stored.ok ? stored.message.id : null });
  if (!stored.ok) {
    const error =
      stored.kind === "missing" ? CHAT_ERRORS.chatMissing : stored.kind === "stale" ? CHAT_ERRORS.inactive : CHAT_ERRORS.notSaved;
    return { ok: false, error, flagged };
  }
  void markCheckInCompleted(op.profileId, op); // 12.9
  return { ok: true, value: { op, message: stored.message, flagged } };
}

/**
 * Sends a typed user Message and requests a reply (4.1, 4.2, 4.7, 4.8).
 * The text is stored as typed (not trimmed). If the user Message cannot be
 * stored, no generation request is sent.
 */
export async function sendMessage(chatId: string, text: string, opts: SendOptions = {}): Promise<SendResult> {
  const v = validateMessageText(text);
  if (!v.ok) return { userMessage: null, flagged: false, error: { message: v.error, retryable: false } };
  const r = await repo();
  if (r.mode !== "ready") {
    return { userMessage: null, flagged: detectCrisis(text).flagged, error: { message: CHAT_ERRORS.unavailable, retryable: false } };
  }
  const stored = await storeUser(r, chatId, v.value);
  if (!stored.ok) {
    return { userMessage: null, flagged: stored.flagged, error: { message: stored.error, retryable: false } };
  }
  return generateReply(r, stored.value.op, stored.value.message, opts);
}

/**
 * Re-requests a reply for an existing user Message without storing it again
 * (4.7, 6.26). Also used by the voice call after `storeUserMessage`.
 */
export async function retry(chatId: string, userMessageId: string, opts: SendOptions = {}): Promise<SendResult> {
  const r = await repo();
  if (r.mode !== "ready") {
    return { userMessage: null, flagged: false, error: { message: CHAT_ERRORS.unavailable, retryable: false } };
  }
  const ctx = await contextFor(r, chatId);
  if ("error" in ctx) return { userMessage: null, flagged: false, error: { message: ctx.error, retryable: false } };

  const found = await r.tx(ctx.op, ["messages"], (t) => t.get("messages", userMessageId));
  const message = found.ok ? found.value : undefined;
  if (!message || message.chatId !== chatId || message.role !== "user") {
    return { userMessage: null, flagged: false, error: { message: CHAT_ERRORS.chatMissing, retryable: false } };
  }
  return generateReply(r, ctx.op, message, opts);
}

/** Alias for the voice controller: request a reply to a stored user Message. */
export const requestReply = retry;

/**
 * Stores a final speech transcript as a user Message (5.4, 14.1). Runs the
 * Safety_Monitor and emits the crisis signal; does not request a reply.
 */
export async function storeUserMessage(
  chatId: string,
  text: string,
): Promise<ServiceResult<{ message: Message; flagged: boolean }>> {
  if (text.trim().length === 0) return fail(CHAT_ERRORS.notSaved);
  const r = await repo();
  if (r.mode !== "ready") return fail(CHAT_ERRORS.unavailable);
  const stored = await storeUser(r, chatId, text.slice(0, MESSAGE_CONTENT_MAX));
  if (!stored.ok) return fail(stored.error);
  return ok({ message: stored.value.message, flagged: stored.value.flagged });
}

/** Stores a Companion Message (call greeting, late reply captions). Guarded like replies. */
export async function storeCompanionMessage(chatId: string, text: string): Promise<ServiceResult<Message>> {
  if (text.trim().length === 0) return fail(CHAT_ERRORS.emptyReply);
  const r = await repo();
  if (r.mode !== "ready") return fail(CHAT_ERRORS.unavailable);
  const ctx = await contextFor(r, chatId);
  if ("error" in ctx) return fail(ctx.error);

  // Keep ordering after the latest Message of the Chat.
  const last = await r.messagesByChat(chatId, { limit: 1 }).catch(() => [] as Message[]);
  const createdAt = last[0] ? strictlyAfter(last[0].createdAt) : nowIso();
  const stored = await storeMessage(r, ctx.op, chatId, "companion", text, false, createdAt);
  if (!stored.ok) {
    return fail(stored.kind === "missing" ? CHAT_ERRORS.chatMissing : stored.kind === "stale" ? CHAT_ERRORS.inactive : CHAT_ERRORS.notSaved);
  }
  return ok(stored.message);
}

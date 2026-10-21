/**
 * Memory_Extractor and Memory_Store service (Req 8, 9.5–9.9, 10.5, 10.9, 10.10, 20.7, 20.8).
 *
 * - Extraction runs after a reply is stored, from the user Message and the
 *   Companion Message immediately preceding it (8.1, 8.3).
 * - Failed extractions go into a per-tab retry queue: each queued Message is
 *   retried after each later successful reply, at most 3 times (8.5).
 * - Every write re-checks, inside its transaction, that the Profile is still
 *   active, the restore epoch is unchanged, and the source Chat still exists;
 *   otherwise the result is discarded (10.10, 20.7, 20.29).
 * - Profile_Summary regeneration triggers: chat end, ≥ 10 new Memories since
 *   the last summary, chat deletion, and app load when `summaryStale` is set
 *   (9.5, 10.5, 10.9). Output is truncated to 1,500 characters (9.6).
 */
import { buildExtractionRequest, buildSummaryRequest, truncateSummary } from "@/core/context";
import { mergeMemories, parseExtraction } from "@/core/memory";
import type { Memory, MemoryCategory, Message, ProfileMeta, Settings } from "@/core/models";
import { validateMemoryContent, validateSummary } from "@/core/validators";
import { getRepo, initRepo, type OperationContext, type Repo } from "@/data/repository";
import { modelRouter } from "./modelRouter";
import type { ServiceResult } from "./profileService";
import { getActiveProfileId, getEpoch, opFor } from "./session";

export type { ServiceResult };

/** Retry attempts allowed per failed extraction (8.5). */
export const MAX_EXTRACTION_RETRIES = 3;
/** New Memories since the last summary that trigger regeneration (9.5). */
export const SUMMARY_REGEN_THRESHOLD = 10;

export const MEMORY_ERRORS = {
  unavailable: "Local storage is unavailable, so the change was not saved.",
  notFound: "That memory no longer exists.",
  failed: "The change could not be saved. Please try again.",
  inactive: "This Profile is no longer active, so the change was not saved.",
} as const;

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
const fail = (error: string): ServiceResult<never> => ({ ok: false, error });

const nowIso = () => new Date().toISOString();
const laterOf = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);

async function repo(): Promise<Repo> {
  return getRepo() ?? (await initRepo());
}

// ---------------------------------------------------------------------------
// Operation guard (shared with chatService / chatDeletion)
// ---------------------------------------------------------------------------

/** Thrown inside a transaction to abort a stale write. */
export class StaleOperation extends Error {
  constructor() {
    super("stale_operation");
    this.name = "StaleOperation";
  }
}

/**
 * True while `op` is still current: its Profile is the Active_Profile and the
 * restore epoch is unchanged (20.7, 20.29). Synchronous, so it is safe inside
 * a transaction.
 */
export function isOpCurrent(op: OperationContext): boolean {
  return getActiveProfileId() === op.profileId && getEpoch() === op.epoch;
}

/** Throws `StaleOperation` if `op` is no longer current. */
export function assertOpCurrent(op: OperationContext): void {
  if (!isOpCurrent(op)) throw new StaleOperation();
}

/** Default bookkeeping record for a Profile without one. */
export const defaultProfileMeta = (profileId: string, now: string): ProfileMeta => ({
  profileId,
  activityConsent: null,
  newMemoriesSinceSummary: 0,
  summaryStale: false,
  lastBreakSuggestionDate: null,
  updatedAt: now,
});

// ---------------------------------------------------------------------------
// Extraction and retry queue (8.1–8.5, 8.9, 20.26)
// ---------------------------------------------------------------------------

interface QueueEntry {
  op: OperationContext;
  chatId: string;
  userMessageId: string;
  /** Retry attempts already made. */
  retries: number;
}

/** Failed extractions, keyed by user Message id (per tab, in memory). */
const retryQueue = new Map<string, QueueEntry>();
/** Extractions currently running, to avoid duplicate work for one Message. */
const inFlight = new Set<string>();

export type ExtractionOutcome =
  | { status: "stored"; created: number; updated: number }
  | { status: "failed" }
  | { status: "discarded" };

async function loadSettings(r: Repo, profileId: string): Promise<Settings | undefined> {
  try {
    return await r.getSettings(profileId);
  } catch {
    return undefined;
  }
}

/** One extraction attempt. Never throws. */
async function runExtraction(op: OperationContext, chatId: string, userMessageId: string): Promise<ExtractionOutcome> {
  if (!isOpCurrent(op)) return { status: "discarded" };
  const r = await repo();
  if (r.mode !== "ready") return { status: "failed" };

  try {
    // Locate the user Message and the Message immediately before it.
    const found = await r.tx(op, ["messages"], (t) => t.get("messages", userMessageId));
    if (!found.ok) return found.error.kind === "stale" ? { status: "discarded" } : { status: "failed" };
    const userMsg: Message | undefined = found.value;
    if (!userMsg || userMsg.chatId !== chatId || userMsg.profileId !== op.profileId || userMsg.role !== "user") {
      return { status: "discarded" };
    }
    const before = await r.messagesByChat(chatId, { before: userMsg.createdAt, limit: 1 });
    const prev = before[before.length - 1];
    const prevCompanion = prev && prev.role === "companion" ? prev : undefined;

    const settings = await loadSettings(r, op.profileId);
    if (!settings) return { status: "failed" };

    const req = buildExtractionRequest({ userText: userMsg.content, previousCompanionText: prevCompanion?.content });
    const raw = await modelRouter.generate(settings, req);
    const parsed = parseExtraction(raw);
    if (!parsed.ok) return { status: "failed" }; // 20.26: treated as a router error
    if (!isOpCurrent(op)) return { status: "discarded" };

    const messageIds = prevCompanion ? [userMsg.id, prevCompanion.id] : [userMsg.id];
    let discarded = false;
    const res = await r.tx(op, ["memories", "profileMeta"], async (t) => {
      assertOpCurrent(op);
      // The source Chat and Messages must still exist (10.10).
      const chat = await t.get("chats", chatId);
      if (!chat || chat.profileId !== op.profileId) {
        discarded = true;
        throw new StaleOperation();
      }
      for (const id of messageIds) {
        if (!(await t.get("messages", id))) {
          discarded = true;
          throw new StaleOperation();
        }
      }
      const now = nowIso();
      const storedMeta = await t.get("profileMeta", op.profileId);
      const meta = storedMeta ?? defaultProfileMeta(op.profileId, now);
      if (parsed.items.length === 0) {
        return { created: 0, updated: 0, stale: meta.summaryStale, count: meta.newMemoriesSinceSummary };
      }

      const existing = await t.getAllByIndex("memories", "byProfile", op.profileId);
      const merge = mergeMemories(
        existing,
        parsed.items,
        { profileId: op.profileId, chatId, messageIds },
        now,
        () => crypto.randomUUID(),
      );
      for (const m of merge.upserts) await t.put("memories", m);

      const count = meta.newMemoriesSinceSummary + merge.createdCount;
      if (merge.createdCount > 0 || !storedMeta) {
        await t.put("profileMeta", { ...meta, newMemoriesSinceSummary: count, updatedAt: now });
      }
      return {
        created: merge.createdCount,
        updated: merge.upserts.length - merge.createdCount,
        stale: meta.summaryStale,
        count,
      };
    });
    if (!res.ok) {
      if (discarded || res.error.kind === "stale") return { status: "discarded" };
      return { status: "failed" };
    }

    // 9.5: ≥ 10 new Memories; 10.9: a stale summary regenerates on the next successful extraction.
    if (res.value.count >= SUMMARY_REGEN_THRESHOLD || res.value.stale) {
      void regenerateSummary(op.profileId);
    }
    return { status: "stored", created: res.value.created, updated: res.value.updated };
  } catch (err) {
    if (err instanceof StaleOperation) return { status: "discarded" };
    return { status: "failed" };
  }
}

/**
 * Extracts Memories for one user Message (8.1). On failure the Message is
 * queued for retry after later successful replies (8.5). `op` defaults to the
 * current Active_Profile; the extraction is discarded if it no longer matches
 * when the result arrives (20.7).
 */
export async function extractFor(
  chatId: string,
  userMessageId: string,
  op?: OperationContext,
): Promise<ExtractionOutcome> {
  const active = getActiveProfileId();
  const ctx = op ?? (active ? opFor(active, chatId) : null);
  if (!ctx) return { status: "discarded" };
  if (inFlight.has(userMessageId)) return { status: "discarded" };

  inFlight.add(userMessageId);
  try {
    const outcome = await runExtraction(ctx, chatId, userMessageId);
    if (outcome.status === "failed" && !retryQueue.has(userMessageId)) {
      retryQueue.set(userMessageId, { op: ctx, chatId, userMessageId, retries: 0 });
    }
    return outcome;
  } finally {
    inFlight.delete(userMessageId);
  }
}

/**
 * Retries every queued extraction once (8.5). Called after each successful
 * reply generation. Entries are dropped after success, after the 3rd failed
 * retry, or when their result would be discarded (stale Profile, deleted Chat).
 */
export async function drainRetryQueue(): Promise<void> {
  const entries = [...retryQueue.values()];
  for (const entry of entries) {
    if (inFlight.has(entry.userMessageId)) continue;
    if (!isOpCurrent(entry.op)) {
      // Results for an inactive Profile are discarded (20.7); keep the entry
      // only while the epoch matches so it can resume when the Profile returns.
      if (getEpoch() !== entry.op.epoch) retryQueue.delete(entry.userMessageId);
      continue;
    }
    inFlight.add(entry.userMessageId);
    try {
      entry.retries++;
      const outcome = await runExtraction(entry.op, entry.chatId, entry.userMessageId);
      if (outcome.status !== "failed" || entry.retries >= MAX_EXTRACTION_RETRIES) {
        retryQueue.delete(entry.userMessageId);
      }
    } finally {
      inFlight.delete(entry.userMessageId);
    }
  }
}

/**
 * Hook called by chatService after a reply is stored: drains earlier failed
 * extractions, then extracts for this Message (fire-and-forget).
 */
export function onReplyStored(
  op: OperationContext,
  chatId: string,
  userMessageId: string,
  userText?: string,
): void {
  void (async () => {
    await drainRetryQueue();
    // Trivial messages carry nothing worth remembering; skip the model call.
    if (userText !== undefined && isTrivialForExtraction(userText)) return;
    scheduleExtraction({ op, chatId, userMessageId });
  })().catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Call budget: skip trivial messages, at most one extraction per chat per 20 s
// ---------------------------------------------------------------------------

/** Minimum gap between extractions for one Chat. */
export const EXTRACTION_MIN_INTERVAL_MS = 20_000;
/** Messages with fewer non-space characters are not extracted. */
export const EXTRACTION_MIN_CHARS = 12;

const TRIVIAL_MESSAGES = new Set([
  "hi", "hey", "hello", "hiya", "yo", "sup", "ok", "okay", "k", "kk", "okey", "alright",
  "thanks", "thank you", "thanks a lot", "thank you so much", "thx", "ty", "cheers",
  "yes", "yeah", "yep", "yup", "sure", "no", "nope", "nah", "cool", "nice", "great",
  "good", "fine", "lol", "haha", "hmm", "bye", "good night", "goodnight", "see you",
  "got it", "sounds good", "good morning", "good evening", "ok thanks", "okay thanks",
]);

/** True for very short or pure greeting/acknowledgement messages. */
export function isTrivialForExtraction(text: string): boolean {
  if (text.replace(/\s/g, "").length < EXTRACTION_MIN_CHARS) return true;
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return TRIVIAL_MESSAGES.has(normalized);
}

interface PendingExtraction {
  op: OperationContext;
  chatId: string;
  userMessageId: string;
}

interface ChatThrottle {
  lastRunAt: number;
  pending: PendingExtraction | null;
  timer: ReturnType<typeof setTimeout> | null;
}

const chatThrottles = new Map<string, ChatThrottle>();

function runPending(job: PendingExtraction, throttle: ChatThrottle): void {
  throttle.lastRunAt = Date.now();
  void extractFor(job.chatId, job.userMessageId, job.op).catch(() => undefined);
}

/**
 * Runs extraction now if the Chat had none in the last 20 s; otherwise keeps
 * only the latest Message and runs it when the window opens.
 */
function scheduleExtraction(job: PendingExtraction): void {
  let throttle = chatThrottles.get(job.chatId);
  if (!throttle) {
    throttle = { lastRunAt: 0, pending: null, timer: null };
    chatThrottles.set(job.chatId, throttle);
  }
  const t = throttle;
  const waitMs = t.lastRunAt + EXTRACTION_MIN_INTERVAL_MS - Date.now();
  if (waitMs <= 0 && t.timer === null) {
    runPending(job, t);
    return;
  }
  t.pending = job; // coalesce: the latest Message wins
  if (t.timer !== null) return;
  t.timer = setTimeout(() => {
    t.timer = null;
    const next = t.pending;
    t.pending = null;
    if (next) runPending(next, t);
  }, Math.max(0, waitMs));
}

function dropThrottle(chatId: string): void {
  const t = chatThrottles.get(chatId);
  if (t?.timer) clearTimeout(t.timer);
  chatThrottles.delete(chatId);
}

/** Drops queued retries for a deleted Chat (10.10). */
export function forgetQueuedForChat(chatId: string): void {
  for (const [id, e] of retryQueue) if (e.chatId === chatId) retryQueue.delete(id);
  dropThrottle(chatId);
}

/** Drops queued retries for a Profile (reset or deletion). */
export function forgetQueuedForProfile(profileId: string): void {
  for (const [id, e] of retryQueue) if (e.op.profileId === profileId) retryQueue.delete(id);
  for (const [chatId, t] of chatThrottles) {
    if (t.pending?.op.profileId === profileId) dropThrottle(chatId);
  }
}

/** Number of queued extraction retries (for diagnostics). */
export const pendingExtractionRetries = (): number => retryQueue.size;

// ---------------------------------------------------------------------------
// Profile_Summary regeneration (9.5, 9.6, 9.9, 10.5, 10.9)
// ---------------------------------------------------------------------------

export type SummaryOutcome = "updated" | "failed" | "discarded";

const regenRunning = new Map<string, Promise<SummaryOutcome>>();
const regenAgain = new Set<string>();

/** Identity of a memory set; a change means the snapshot is outdated. */
const memorySignature = (memories: readonly Memory[]): string =>
  memories
    .map((m) => `${m.id}\u0000${m.updatedAt}\u0000${m.category}\u0000${m.content}`)
    .sort()
    .join("\u0001");

async function regenerateOnce(profileId: string): Promise<SummaryOutcome> {
  const op = opFor(profileId);
  if (!isOpCurrent(op)) return "discarded";
  const r = await repo();
  if (r.mode !== "ready") return "failed";

  try {
    const memories = await r.memoriesByProfile(profileId);
    const signature = memorySignature(memories);

    let content = "";
    if (memories.length > 0) {
      const settings = await loadSettings(r, profileId);
      if (!settings) return "failed";
      const raw = await modelRouter.generate(settings, buildSummaryRequest(memories, profileId));
      content = truncateSummary(raw);
      // An empty answer is a failure; keep the stored summary (9.9).
      if (content.length === 0) return "failed";
    }
    // Zero memories → empty summary without a model call (10.5).
    if (!isOpCurrent(op)) return "discarded";

    let outdated = false;
    const res = await r.tx(op, ["summaries", "profileMeta", "memories"], async (t) => {
      assertOpCurrent(op);
      // Never store a summary derived from memories that changed or were deleted (10.6).
      const current = await t.getAllByIndex("memories", "byProfile", profileId);
      if (memorySignature(current) !== signature) {
        outdated = true;
        throw new StaleOperation();
      }
      const now = nowIso();
      await t.put("summaries", { profileId, content, updatedAt: now });
      const meta = (await t.get("profileMeta", profileId)) ?? defaultProfileMeta(profileId, now);
      await t.put("profileMeta", { ...meta, newMemoriesSinceSummary: 0, summaryStale: false, updatedAt: now });
    });
    if (!res.ok) {
      if (outdated) {
        regenAgain.add(profileId);
        return "discarded";
      }
      return res.error.kind === "stale" ? "discarded" : "failed";
    }
    return "updated";
  } catch (err) {
    if (err instanceof StaleOperation) return "discarded";
    return "failed";
  }
}

/**
 * Regenerates the Profile_Summary from the Profile's remaining Memories.
 * Concurrent calls for one Profile share a run; a call during a run schedules
 * one more run afterwards. On failure the stored summary is kept unchanged
 * (9.9) — after a chat deletion it is already empty (10.9).
 */
export function regenerateSummary(profileId: string): Promise<SummaryOutcome> {
  const running = regenRunning.get(profileId);
  if (running) {
    regenAgain.add(profileId);
    return running;
  }
  const run = (async () => {
    let outcome: SummaryOutcome;
    let rounds = 0;
    do {
      regenAgain.delete(profileId);
      outcome = await regenerateOnce(profileId);
      rounds++;
    } while (regenAgain.has(profileId) && rounds < 3);
    regenAgain.delete(profileId);
    return outcome;
  })().finally(() => regenRunning.delete(profileId));
  regenRunning.set(profileId, run);
  return run;
}

/** Chat end trigger (9.5). Fire-and-forget. */
export function onChatEnded(profileId: string): void {
  void regenerateSummary(profileId);
}

/** App-load trigger: regenerates when `summaryStale` is set (10.9). */
export async function regenerateIfStale(profileId: string): Promise<SummaryOutcome | null> {
  const r = await repo();
  if (r.mode !== "ready") return null;
  try {
    const meta = await r.getProfileMeta(profileId);
    if (!meta?.summaryStale) return null;
  } catch {
    return null;
  }
  return regenerateSummary(profileId);
}

// ---------------------------------------------------------------------------
// Memories page and Profile_Summary editor (8.7, 8.8, 9.7, 9.8)
// ---------------------------------------------------------------------------

/** Replaces a Memory's content and category; keeps its sources (8.7). */
export async function updateMemory(
  memoryId: string,
  content: string,
  category: MemoryCategory,
): Promise<ServiceResult<Memory>> {
  const v = validateMemoryContent(content);
  if (!v.ok) return fail(v.error);
  const profileId = getActiveProfileId();
  if (!profileId) return fail(MEMORY_ERRORS.inactive);
  const r = await repo();
  if (r.mode !== "ready") return fail(MEMORY_ERRORS.unavailable);

  const op = opFor(profileId);
  let missing = false;
  const res = await r.tx(op, ["memories"], async (t) => {
    assertOpCurrent(op);
    const current = await t.get("memories", memoryId);
    if (!current || current.profileId !== profileId) {
      missing = true;
      throw new Error("missing");
    }
    const next: Memory = {
      ...current,
      content: v.value,
      category,
      updatedAt: laterOf(nowIso(), current.createdAt),
    };
    await t.put("memories", next);
    return next;
  });
  if (missing) return fail(MEMORY_ERRORS.notFound);
  if (!res.ok) return fail(res.error.kind === "stale" ? MEMORY_ERRORS.inactive : MEMORY_ERRORS.failed);
  return ok(res.value);
}

/** Permanently removes a Memory (8.8). */
export async function deleteMemory(memoryId: string): Promise<ServiceResult> {
  const profileId = getActiveProfileId();
  if (!profileId) return fail(MEMORY_ERRORS.inactive);
  const r = await repo();
  if (r.mode !== "ready") return fail(MEMORY_ERRORS.unavailable);

  const op = opFor(profileId);
  let missing = false;
  const res = await r.tx(op, ["memories"], async (t) => {
    assertOpCurrent(op);
    const current = await t.get("memories", memoryId);
    if (!current || current.profileId !== profileId) {
      missing = true;
      throw new Error("missing");
    }
    await t.delete("memories", memoryId);
  });
  if (missing) return fail(MEMORY_ERRORS.notFound);
  if (!res.ok) return fail(MEMORY_ERRORS.failed);
  return ok(undefined);
}

/**
 * Saves a user-edited Profile_Summary (9.7, 9.8). The user's text replaces
 * any pending stale state, so app load will not overwrite it.
 */
export async function saveSummary(profileId: string, content: string): Promise<ServiceResult<string>> {
  const v = validateSummary(content);
  if (!v.ok) return fail(v.error);
  const r = await repo();
  if (r.mode !== "ready") return fail(MEMORY_ERRORS.unavailable);

  const op = opFor(profileId);
  const res = await r.tx(op, ["summaries", "profileMeta"], async (t) => {
    assertOpCurrent(op);
    const now = nowIso();
    await t.put("summaries", { profileId, content: v.value, updatedAt: now });
    const meta = await t.get("profileMeta", profileId);
    if (meta?.summaryStale) await t.put("profileMeta", { ...meta, summaryStale: false, updatedAt: now });
  });
  if (!res.ok) return fail(res.error.kind === "stale" ? MEMORY_ERRORS.inactive : MEMORY_ERRORS.failed);
  return ok(v.value);
}

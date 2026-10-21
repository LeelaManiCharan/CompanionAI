/**
 * Reminder_Service (Req 24): extracts reminders from user Messages, stores
 * them, and changes their status (cancel from Home, done when the call starts).
 * Firing is done by the Check_In_Scheduler.
 */
import type { ReminderSet } from "@/core/context";
import type { Message, Reminder, ReminderStatus, Settings } from "@/core/models";
import {
  buildReminderRequest,
  describeDue,
  mightBeReminder,
  parseReminder,
  REMINDER_EXTRACT_TIMEOUT_MS,
} from "@/core/reminders";
import { getRepo, initRepo, type OperationContext, type Repo } from "@/data/repository";
import { currentTimeZone } from "./activityTracker";
import { assertOpCurrent } from "./memoryService";
import { modelRouter } from "./modelRouter";
import type { ServiceResult } from "./profileService";
import { getActiveProfileId, opFor } from "./session";

export const REMINDER_ERRORS = {
  unavailable: "Local storage is unavailable, so the reminder was not changed.",
  notFound: "That reminder no longer exists.",
  failed: "The reminder could not be updated. Please try again.",
} as const;

/** Results per user Message, so a retried reply neither re-extracts nor duplicates (4.7). */
const handled = new Map<string, ReminderSet | null>();
const HANDLED_MAX = 50;

function remember(messageId: string, value: ReminderSet | null): void {
  handled.set(messageId, value);
  if (handled.size > HANDLED_MAX) {
    const first = handled.keys().next().value;
    if (first !== undefined) handled.delete(first);
  }
}

/**
 * Runs reminder extraction for a stored user Message when the pre-filter
 * matches, stores the Reminder, and returns what the companion should
 * confirm. Never throws; any failure returns null (24.1).
 */
export async function extractReminder(
  r: Repo,
  op: OperationContext,
  userMessage: Message,
  settings: Settings,
  previousCompanionText: string | null,
  signal?: AbortSignal,
): Promise<ReminderSet | null> {
  if (handled.has(userMessage.id)) return handled.get(userMessage.id) ?? null;
  if (!mightBeReminder(userMessage.content)) return null;

  const timeZone = currentTimeZone();
  const nowMs = Date.now();
  const req = buildReminderRequest({
    userText: userMessage.content,
    nowIso: new Date(nowMs).toISOString(),
    timeZone,
    previousCompanionText,
  });

  let raw: string;
  try {
    const timeout = AbortSignal.timeout(REMINDER_EXTRACT_TIMEOUT_MS);
    raw = await modelRouter.generate(settings, req, { signal: signal ? AbortSignal.any([timeout, signal]) : timeout });
  } catch {
    return null;
  }

  const parsed = parseReminder(raw, timeZone, Date.now());
  if (!parsed) {
    remember(userMessage.id, null);
    return null;
  }

  const reminder: Reminder = {
    id: crypto.randomUUID(),
    profileId: op.profileId,
    chatId: userMessage.chatId,
    text: parsed.text,
    dueAt: parsed.dueAt,
    createdAt: new Date().toISOString(),
    status: "pending",
    firedAt: null,
  };
  const res = await r
    .tx(op, ["reminders"], async (t) => {
      assertOpCurrent(op);
      await t.put("reminders", reminder);
    })
    .catch(() => null);
  if (!res || !res.ok) return null;

  const set: ReminderSet = { text: reminder.text, dueLocal: describeDue(reminder.dueAt, timeZone, Date.now()) };
  remember(userMessage.id, set);
  return set;
}

async function repo(): Promise<Repo> {
  return getRepo() ?? (await initRepo());
}

/** Sets the status of a Reminder of the Active_Profile. */
async function setStatus(id: string, status: ReminderStatus): Promise<ServiceResult<Reminder>> {
  const profileId = getActiveProfileId();
  if (!profileId) return { ok: false, error: REMINDER_ERRORS.notFound };
  const r = await repo();
  if (r.mode !== "ready") return { ok: false, error: REMINDER_ERRORS.unavailable };

  let missing = false;
  const res = await r.tx(opFor(profileId), ["reminders"], async (t) => {
    const cur = await t.get("reminders", id);
    if (!cur || cur.profileId !== profileId) {
      missing = true;
      throw new Error("missing");
    }
    if (cur.status === status) return cur;
    const next: Reminder = { ...cur, status };
    await t.put("reminders", next);
    return next;
  });
  if (missing) return { ok: false, error: REMINDER_ERRORS.notFound };
  if (!res.ok) return { ok: false, error: REMINDER_ERRORS.failed };
  return { ok: true, value: res.value };
}

/** Cancels a pending Reminder (24.8). */
export function cancelReminder(id: string): Promise<ServiceResult<Reminder>> {
  return setStatus(id, "cancelled");
}

/** Marks a Reminder done, e.g. when its call starts (24.7). */
export function completeReminder(id: string): Promise<ServiceResult<Reminder>> {
  return setStatus(id, "done");
}

/** Reads one Reminder of the Active_Profile, or null. */
export async function getReminder(id: string): Promise<Reminder | null> {
  const profileId = getActiveProfileId();
  const r = getRepo();
  if (!profileId || !r || r.mode !== "ready") return null;
  const res = await r.tx(opFor(profileId), ["reminders"], (t) => t.get("reminders", id)).catch(() => null);
  const rem = res && res.ok ? res.value : undefined;
  return rem && rem.profileId === profileId ? rem : null;
}

/**
 * Minimal Daily_Check_In completion helper (Req 12.9).
 *
 * Sending a Chat Message or starting a voice call marks today's check-in as
 * completed for the Profile. The Check_In_Scheduler reuses this helper so
 * there is exactly one writer of `completedAt`.
 */
import type { CheckIn } from "@/core/models";
import { localDate } from "@/core/schedule";
import { getRepo, initRepo, type OperationContext, type Repo } from "@/data/repository";
import { getActiveProfileId, getEpoch, opFor } from "./session";

/** Change listeners (the scheduler subscribes to cancel pending triggers). */
type CompletionListener = (profileId: string, date: string) => void;
const listeners = new Set<CompletionListener>();

export function onCheckInCompleted(listener: CompletionListener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** The browser's IANA time zone (falls back to UTC). */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

async function repo(): Promise<Repo> {
  return getRepo() ?? (await initRepo());
}

const laterOf = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);

/**
 * Upserts today's CheckIn record for `profileId` with `completedAt` set.
 * A record that is already completed is left unchanged. Returns true when the
 * check-in is (now) completed. Never throws.
 */
export async function markCheckInCompleted(
  profileId: string,
  op: OperationContext = opFor(profileId),
): Promise<boolean> {
  try {
    const r = await repo();
    if (r.mode !== "ready") return false;
    const now = new Date().toISOString();
    const date = localDate(now, browserTimeZone());

    let changed = false;
    const res = await r.tx(op, ["checkIns"], async (t) => {
      // Write only for the Profile that is still active in the same epoch (20.7, 20.8).
      if (getActiveProfileId() !== op.profileId || getEpoch() !== op.epoch) throw new Error("stale");
      const existing = await t.get("checkIns", [profileId, date]);
      if (existing?.completedAt) return;
      const next: CheckIn = existing
        ? { ...existing, completedAt: laterOf(now, existing.triggeredAt) }
        : {
            profileId,
            date,
            triggeredAt: now,
            snoozedUntil: null,
            completedAt: now,
            snoozeFiredAt: null,
          };
      await t.put("checkIns", next);
      changed = true;
    });
    if (!res.ok) return false;
    if (changed) {
      for (const l of [...listeners]) {
        try {
          l(profileId, date);
        } catch {
          /* listener failures must not affect chat */
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

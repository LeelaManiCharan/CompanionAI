/**
 * Profile_Manager (Req 1, 2.3, 6.2, 6.3).
 *
 * - `createProfile`: at most 3 Profiles; writes the Profile, default Settings,
 *   ProfileMeta, and an empty Summary in one transaction, then makes it active.
 * - `selectProfile`: stamps `lastUsedAt` and makes it active.
 * - `deleteProfile`: removes the Profile and everything it owns in one
 *   transaction; if it was active, picks the next one via `pickActiveProfile`.
 * - `loadActiveProfile`: startup selection via `pickActiveProfile` (1.5, 1.6).
 *
 * Every failure leaves the Local_Store unchanged (one transaction per operation)
 * and returns a user-facing message (1.9).
 */
import type { Profile, ProfileMeta, Summary } from "@/core/models";
import { pickActiveProfile } from "@/core/selectors";
import { defaultSettings, validateDisplayName } from "@/core/validators";
import { getRepo, initRepo, type Repo } from "@/data/repository";
import { getActiveProfileId, opFor, setActiveProfileId } from "./session";

export const MAX_PROFILES = 3;

export const PROFILE_ERRORS = {
  limit: "You can have at most 3 Profiles. The limit is 3 Profiles.",
  notFound: "That Profile no longer exists.",
  failed: "The operation failed. Your Profiles were not changed.",
  unavailable: "Local storage is unavailable, so the operation failed.",
} as const;

export type ServiceResult<T = void> = { ok: true; value: T } | { ok: false; error: string };

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
const fail = (error: string): ServiceResult<never> => ({ ok: false, error });

const nowIso = () => new Date().toISOString();

async function repo(): Promise<Repo> {
  return getRepo() ?? (await initRepo());
}

/** Upper bound for string key components in range queries. */
const MAX_STRING = "\uffff";

/** Creates a Profile with defaults and sets it as the Active_Profile (1.1, 1.2, 1.7, 2.3). */
export async function createProfile(displayName: string): Promise<ServiceResult<Profile>> {
  const name = validateDisplayName(displayName);
  if (!name.ok) return fail(name.error);

  const r = await repo();
  if (r.mode !== "ready") return fail(PROFILE_ERRORS.unavailable);

  const now = nowIso();
  const id = crypto.randomUUID();
  const profile: Profile = { id, displayName: name.value, createdAt: now, lastUsedAt: now };
  const meta: ProfileMeta = {
    profileId: id,
    activityConsent: null,
    newMemoriesSinceSummary: 0,
    summaryStale: false,
    lastBreakSuggestionDate: null,
    updatedAt: now,
  };
  const summary: Summary = { profileId: id, content: "", updatedAt: now };

  let limitReached = false;
  const res = await r.tx(opFor(id), ["profiles", "settings", "profileMeta", "summaries"], async (t) => {
    // Count inside the transaction so concurrent creates cannot exceed the limit.
    const existing = await t.getAll("profiles");
    if (existing.length >= MAX_PROFILES) {
      limitReached = true;
      throw new Error("profile limit");
    }
    await t.put("profiles", profile);
    await t.put("settings", defaultSettings(id, now));
    await t.put("profileMeta", meta);
    await t.put("summaries", summary);
  });
  if (limitReached) return fail(PROFILE_ERRORS.limit);
  if (!res.ok) return fail(PROFILE_ERRORS.failed);

  setActiveProfileId(id);
  return ok(profile);
}

/** Sets the Active_Profile and records the selection time as `lastUsedAt` (1.3). */
export async function selectProfile(id: string): Promise<ServiceResult<Profile>> {
  const r = await repo();
  if (r.mode !== "ready") return fail(PROFILE_ERRORS.unavailable);

  let missing = false;
  const res = await r.tx(opFor(id), ["profiles"], async (t) => {
    const current = await t.get("profiles", id);
    if (!current) {
      missing = true;
      throw new Error("profile missing");
    }
    const now = nowIso();
    // Clock skew must not move lastUsedAt before createdAt (model refinement).
    const lastUsedAt = Date.parse(now) >= Date.parse(current.createdAt) ? now : current.createdAt;
    const next: Profile = { ...current, lastUsedAt };
    await t.put("profiles", next);
    return next;
  });
  if (missing) return fail(PROFILE_ERRORS.notFound);
  if (!res.ok) return fail(PROFILE_ERRORS.failed);

  setActiveProfileId(id);
  return ok(res.value);
}

/**
 * Deletes a Profile and all of its Chats, Messages, Memories, Activity_Logs,
 * Settings, Summary, ProfileMeta, and CheckIns in one transaction (1.4, 1.9).
 * If it was the Active_Profile, the most recently used remaining Profile
 * becomes active, or none when zero remain (1.8). Returns the new active id.
 */
export async function deleteProfile(id: string): Promise<ServiceResult<string | null>> {
  const r = await repo();
  if (r.mode !== "ready") return fail(PROFILE_ERRORS.unavailable);

  let missing = false;
  const res = await r.tx(
    opFor(id),
    [
      "profiles",
      "settings",
      "chats",
      "messages",
      "memories",
      "activityLogs",
      "summaries",
      "profileMeta",
      "checkIns",
      "reminders",
    ],
    async (t) => {
      if (!(await t.get("profiles", id))) {
        missing = true;
        throw new Error("profile missing");
      }
      const messages = await t.getAllByIndex("messages", "byProfile", id);
      const memories = await t.getAllByIndex("memories", "byProfile", id);
      const chats = await t.getAllByIndex("chats", "byProfile", id);
      const logs = await t.getAllByIndex("activityLogs", "byProfile", id);
      const checkIns = await t.getAll("checkIns", IDBKeyRange.bound([id, ""], [id, MAX_STRING]));
      const reminders = await t.getAllByIndex(
        "reminders",
        "byProfileDue",
        IDBKeyRange.bound([id, ""], [id, MAX_STRING]),
      );

      for (const r of reminders) await t.delete("reminders", r.id);
      for (const m of memories) await t.delete("memories", m.id);
      for (const m of messages) await t.delete("messages", m.id);
      for (const c of chats) await t.delete("chats", c.id);
      for (const l of logs) await t.delete("activityLogs", l.id);
      for (const c of checkIns) await t.delete("checkIns", [c.profileId, c.date]);
      await t.delete("settings", id);
      await t.delete("summaries", id);
      await t.delete("profileMeta", id);
      await t.delete("profiles", id);
    },
  );
  if (missing) return fail(PROFILE_ERRORS.notFound);
  if (!res.ok) return fail(PROFILE_ERRORS.failed);

  const active = getActiveProfileId();
  if (active !== null && active !== id) return ok(active);

  let remaining: Profile[];
  try {
    remaining = await r.getProfiles();
  } catch {
    // The delete committed; without a readable list, show the creation screen.
    setActiveProfileId(null);
    return ok(null);
  }
  const next = pickActiveProfile(remaining)?.id ?? null;
  setActiveProfileId(next);
  return ok(next);
}

/**
 * Startup selection (1.5, 1.6): the Profile with the latest `lastUsedAt`
 * becomes active, or `null` (show the creation screen) when none exist.
 */
export async function loadActiveProfile(): Promise<ServiceResult<Profile | null>> {
  const r = await repo();
  if (r.mode === "unavailable") return fail(PROFILE_ERRORS.unavailable);
  try {
    const profile = pickActiveProfile(await r.getProfiles());
    setActiveProfileId(profile?.id ?? null);
    return ok(profile);
  } catch {
    return fail(PROFILE_ERRORS.failed);
  }
}

/** Alias kept for callers that read the active Profile on startup. */
export const getActiveProfile = loadActiveProfile;

/** All Profiles, most recently used first. */
export async function listProfiles(): Promise<ServiceResult<Profile[]>> {
  const r = await repo();
  try {
    return ok(await r.getProfiles());
  } catch {
    return fail(PROFILE_ERRORS.failed);
  }
}

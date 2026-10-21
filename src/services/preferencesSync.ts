/**
 * Preferences_Sync (Req 16.1, 22.11–22.15; design "Authentication (Req 22)").
 *
 * Only the Primary_Profile (oldest `createdAt`, ties by id) syncs with the
 * signed-in user's `user_preferences` row; every other Profile stays local.
 *
 * - `seedPrimaryProfile`: zero local Profiles → create the Primary_Profile from
 *   the remote row, or from the signup display name / email local part and the
 *   default Settings (then upsert those back).
 * - `reconcile`: startup last-write-wins between the remote `updated_at` and
 *   the local `settings.updatedAt` (leader tab only; the caller checks).
 * - `pushPreferences`: upsert after a successful local save. A failure never
 *   rolls the local save back; it raises a quiet `sync_failed` notice instead.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ProviderModeSchema,
  ToneSchema,
  type Profile,
  type ProfileMeta,
  type ProviderMode,
  type Settings,
  type Summary,
  type Tone,
} from "@/core/models";
import {
  defaultSettings,
  validateBotName,
  validateCheckInTime,
  validateDisplayName,
  validateOllamaBaseUrl,
  validateOllamaModel,
} from "@/core/validators";
import { getRepo, type Repo } from "@/data/repository";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { opFor } from "./session";

export const PREFERENCES_TABLE = "user_preferences";
const FALLBACK_DISPLAY_NAME = "Friend";
const MAX_DISPLAY_NAME = 40;
/** Seeding blocks first boot, so a hung read must not hold it forever. */
const REMOTE_TIMEOUT_MS = 10_000;

export interface RemotePrefs {
  user_id: string;
  display_name: string;
  bot_name: string;
  tone: Tone;
  provider_mode: ProviderMode;
  ollama_base_url: string;
  ollama_model: string;
  check_in_time_override: string | null;
  activity_tracking_enabled: boolean;
  notifications_enabled: boolean;
  updated_at: string;
}

/** The Settings fields that follow the user across browsers (22.13). */
export type SyncedSettings = Pick<
  Settings,
  | "botName"
  | "tone"
  | "providerMode"
  | "ollamaBaseUrl"
  | "ollamaModel"
  | "checkInTimeOverride"
  | "activityTrackingEnabled"
  | "notificationsEnabled"
>;

/** Minimal view of the signed-in Supabase user. */
export interface SyncUser {
  id: string;
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

export type SyncResult = { ok: true } | { ok: false; error: "sync_failed" };

// ---------------------------------------------------------------------------
// Pure mapping
// ---------------------------------------------------------------------------

export function toRemote(userId: string, p: Profile, s: Settings): RemotePrefs {
  return {
    user_id: userId,
    display_name: p.displayName,
    bot_name: s.botName,
    tone: s.tone,
    provider_mode: s.providerMode,
    ollama_base_url: s.ollamaBaseUrl,
    ollama_model: s.ollamaModel,
    check_in_time_override: s.checkInTimeOverride,
    activity_tracking_enabled: s.activityTrackingEnabled,
    notifications_enabled: s.notificationsEnabled,
    updated_at: s.updatedAt,
  };
}

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

/**
 * Validates a remote row against the local model rules (19.1, 19.2); each
 * invalid field falls back to its default (22.12).
 */
export function fromRemote(
  r: Partial<Record<keyof RemotePrefs, unknown>>,
  fallbackName: string = FALLBACK_DISPLAY_NAME,
): { displayName: string; settings: SyncedSettings } {
  const d = defaultSettings("_", new Date(0).toISOString());

  const name = validateDisplayName(str(r.display_name) ?? "");
  const fallback = validateDisplayName(fallbackName);
  const bot = validateBotName(str(r.bot_name) ?? "");
  const tone = ToneSchema.safeParse(r.tone);
  const mode = ProviderModeSchema.safeParse(r.provider_mode);

  const rawUrl = str(r.ollama_base_url);
  const url = rawUrl === null ? null : rawUrl.trim() === "" ? "" : validateOllamaBaseUrl(rawUrl);
  const rawModel = str(r.ollama_model);
  const model = rawModel === null ? null : rawModel.trim() === "" ? "" : validateOllamaModel(rawModel);
  const rawTime = str(r.check_in_time_override);
  const time = rawTime === null ? null : validateCheckInTime(rawTime);

  return {
    displayName: name.ok ? name.value : fallback.ok ? fallback.value : FALLBACK_DISPLAY_NAME,
    settings: {
      botName: bot.ok ? bot.value : d.botName,
      tone: tone.success ? tone.data : d.tone,
      providerMode: mode.success ? mode.data : d.providerMode,
      ollamaBaseUrl: url === null ? d.ollamaBaseUrl : typeof url === "string" ? url : url.ok ? url.value : d.ollamaBaseUrl,
      ollamaModel:
        model === null ? d.ollamaModel : typeof model === "string" ? model : model.ok ? model.value : d.ollamaModel,
      checkInTimeOverride: time !== null && time.ok ? time.value : null,
      activityTrackingEnabled:
        typeof r.activity_tracking_enabled === "boolean" ? r.activity_tracking_enabled : d.activityTrackingEnabled,
      notificationsEnabled:
        typeof r.notifications_enabled === "boolean" ? r.notifications_enabled : d.notificationsEnabled,
    },
  };
}

/** Signup display name, else the email local part, truncated to 40 characters (22.12). */
export function seedDisplayName(user: SyncUser): string {
  const meta = user.user_metadata?.display_name;
  const fromMeta = typeof meta === "string" ? meta.trim() : "";
  const local = (user.email ?? "").split("@")[0]?.trim() ?? "";
  const name = (fromMeta || local).slice(0, MAX_DISPLAY_NAME).trim();
  return name || FALLBACK_DISPLAY_NAME;
}

/** Oldest `createdAt`, ties broken by id. */
export function primaryProfile(profiles: readonly Profile[]): Profile | null {
  let best: Profile | null = null;
  for (const p of profiles) {
    if (
      !best ||
      Date.parse(p.createdAt) < Date.parse(best.createdAt) ||
      (Date.parse(p.createdAt) === Date.parse(best.createdAt) && p.id < best.id)
    ) {
      best = p;
    }
  }
  return best;
}

/** Normalizes a timestamptz string to the local `…sssZ` form, or null. */
function toIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

// ---------------------------------------------------------------------------
// Sync notice (quiet, dismissible; shown by AppNotices)
// ---------------------------------------------------------------------------

let syncFailed = false;
const noticeListeners = new Set<() => void>();

function setSyncFailed(value: boolean): void {
  if (syncFailed === value) return;
  syncFailed = value;
  for (const l of [...noticeListeners]) l();
}

export const getSyncFailed = (): boolean => syncFailed;
export const getServerSyncFailed = (): boolean => false;
export function subscribeSyncFailed(cb: () => void): () => void {
  noticeListeners.add(cb);
  return () => void noticeListeners.delete(cb);
}
export const dismissSyncFailed = (): void => setSyncFailed(false);

// ---------------------------------------------------------------------------
// Remote I/O
// ---------------------------------------------------------------------------

type RemoteRead = { ok: true; row: Partial<Record<keyof RemotePrefs, unknown>> | null } | { ok: false };

async function readRemote(sb: SupabaseClient, userId: string): Promise<RemoteRead> {
  try {
    const { data, error } = await sb
      .from(PREFERENCES_TABLE)
      .select("*")
      .eq("user_id", userId)
      .abortSignal(AbortSignal.timeout(REMOTE_TIMEOUT_MS))
      .maybeSingle();
    if (error) return { ok: false };
    return { ok: true, row: (data as Partial<Record<keyof RemotePrefs, unknown>> | null) ?? null };
  } catch {
    return { ok: false };
  }
}

async function upsertRemote(sb: SupabaseClient, row: RemotePrefs): Promise<SyncResult> {
  try {
    const { error } = await sb
      .from(PREFERENCES_TABLE)
      .upsert(row, { onConflict: "user_id" })
      .abortSignal(AbortSignal.timeout(REMOTE_TIMEOUT_MS));
    if (error) {
      setSyncFailed(true);
      return { ok: false, error: "sync_failed" };
    }
    setSyncFailed(false);
    return { ok: true };
  } catch {
    setSyncFailed(true);
    return { ok: false, error: "sync_failed" };
  }
}

async function readPrimary(repo: Repo): Promise<{ profile: Profile; settings: Settings } | null> {
  const profile = primaryProfile(await repo.getProfiles());
  if (!profile) return null;
  const settings = await repo.getSettings(profile.id);
  return settings ? { profile, settings } : null;
}

// ---------------------------------------------------------------------------
// Seed, reconcile, push
// ---------------------------------------------------------------------------

/**
 * Zero local Profiles → create the Primary_Profile and its Settings from the
 * remote row, or from the signup name and defaults (then upsert). The profile
 * count is re-checked inside the write transaction, so concurrent tabs seed
 * at most once.
 */
export async function seedPrimaryProfile(repo: Repo, sb: SupabaseClient, user: SyncUser): Promise<SyncResult> {
  if (repo.mode !== "ready") return { ok: true };
  if ((await repo.getProfiles()).length > 0) return { ok: true };

  const remote = await readRemote(sb, user.id);
  const fallbackName = seedDisplayName(user);
  const mapped = fromRemote(remote.ok && remote.row ? remote.row : {}, fallbackName);
  const fromRow = remote.ok && remote.row !== null;

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const remoteTs = fromRow ? toIso(remote.row?.updated_at) : null;
  const profile: Profile = { id, displayName: mapped.displayName, createdAt: now, lastUsedAt: now };
  const settings: Settings = {
    ...defaultSettings(id, now),
    ...(fromRow ? mapped.settings : {}),
    // Keep the remote timestamp so the next reconcile sees them as equal.
    updatedAt: remoteTs ?? now,
  };
  const meta: ProfileMeta = {
    profileId: id,
    // Tracking already enabled on the account means consent was given elsewhere.
    activityConsent: settings.activityTrackingEnabled ? "opt_in" : null,
    newMemoriesSinceSummary: 0,
    summaryStale: false,
    lastBreakSuggestionDate: null,
    updatedAt: now,
  };
  const summary: Summary = { profileId: id, content: "", updatedAt: now };

  let created = false;
  const res = await repo.tx(opFor(id), ["profiles", "settings", "profileMeta", "summaries"], async (t) => {
    if ((await t.getAll("profiles")).length > 0) return;
    await t.put("profiles", profile);
    await t.put("settings", settings);
    await t.put("profileMeta", meta);
    await t.put("summaries", summary);
    created = true;
  });
  if (!res.ok || !created) return { ok: true };

  // No row yet: publish the seeded values. A failed read is not "no row", so
  // nothing is pushed then (the remote may hold newer values).
  if (remote.ok && remote.row === null) return upsertRemote(sb, toRemote(user.id, profile, settings));
  if (!remote.ok) {
    setSyncFailed(true);
    return { ok: false, error: "sync_failed" };
  }
  return { ok: true };
}

/** Startup last-write-wins for the Primary_Profile (22.14). */
export async function reconcile(repo: Repo, sb: SupabaseClient, user: SyncUser): Promise<SyncResult> {
  if (repo.mode !== "ready") return { ok: true };
  const local = await readPrimary(repo);
  if (!local) return { ok: true };

  const remote = await readRemote(sb, user.id);
  if (!remote.ok) {
    setSyncFailed(true);
    return { ok: false, error: "sync_failed" };
  }
  if (remote.row === null) return upsertRemote(sb, toRemote(user.id, local.profile, local.settings));

  const remoteTs = toIso(remote.row.updated_at);
  const localT = Date.parse(local.settings.updatedAt);
  const remoteT = remoteTs === null ? -Infinity : Date.parse(remoteTs);

  if (localT > remoteT) return upsertRemote(sb, toRemote(user.id, local.profile, local.settings));
  if (remoteTs === null || remoteT === localT) {
    setSyncFailed(false);
    return { ok: true };
  }

  // Remote is newer: replace the local synced fields.
  const mapped = fromRemote(remote.row, local.profile.displayName);
  const profileId = local.profile.id;
  const res = await repo.tx(opFor(profileId), ["profiles", "settings"], async (t) => {
    const p = await t.get("profiles", profileId);
    const s = await t.get("settings", profileId);
    if (!p || !s) throw new Error("primary profile missing");
    // A local save that landed meanwhile wins.
    if (Date.parse(s.updatedAt) >= remoteT) return;
    if (p.displayName !== mapped.displayName) await t.put("profiles", { ...p, displayName: mapped.displayName });
    await t.put("settings", { ...s, ...mapped.settings, updatedAt: remoteTs });
  });
  if (!res.ok) return { ok: false, error: "sync_failed" };
  setSyncFailed(false);
  return { ok: true };
}

/**
 * Upserts the Primary_Profile's synced values after a local commit (22.13).
 * Non-primary Profiles are local-only, so this is a no-op for them (22.15).
 */
export async function pushPreferences(
  repo: Repo,
  sb: SupabaseClient,
  user: SyncUser,
  profileId: string,
): Promise<SyncResult> {
  if (repo.mode !== "ready") return { ok: true };
  let local: { profile: Profile; settings: Settings } | null;
  try {
    local = await readPrimary(repo);
  } catch {
    setSyncFailed(true);
    return { ok: false, error: "sync_failed" };
  }
  if (!local || local.profile.id !== profileId) return { ok: true };
  return upsertRemote(sb, toRemote(user.id, local.profile, local.settings));
}

// ---------------------------------------------------------------------------
// App wiring
// ---------------------------------------------------------------------------

let syncUser: SyncUser | null = null;
let pushChain: Promise<unknown> = Promise.resolve();

/** Set by AppRoot once the user's Local_Store is open; null on sign-out. */
export function setPreferencesSyncUser(user: SyncUser | null): void {
  syncUser = user;
  if (!user) setSyncFailed(false);
}

/**
 * Fire-and-forget push after a successful local save of a synced field.
 * Pushes run one at a time so the last save is the last write.
 */
export function schedulePreferencesPush(profileId: string): void {
  const user = syncUser;
  const repo = getRepo();
  const sb = getBrowserSupabase();
  if (!user || !repo || !sb) return;
  pushChain = pushChain
    .catch(() => undefined)
    .then(() => (syncUser?.id === user.id ? pushPreferences(repo, sb, user, profileId) : undefined));
}

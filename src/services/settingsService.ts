/**
 * Settings_Manager (Req 2, 6.2, 6.3, 6.14, 6.21, 7.5, 7.6, 7.10, 11.4, 11.7,
 * 12.4, 12.5, 18.1, 18.14).
 *
 * Every save validates first; an invalid value or a failed write leaves the
 * stored record unchanged (each save is one read-modify-write transaction).
 * Profile-scoped saves default to the Active_Profile.
 */
import {
  BackupNamespaceId,
  type ActivityConsent,
  type BrowserRecord,
  type CloudStoreConfig,
  type ProfileMeta,
  type ProviderMode,
  type Settings,
  type Tone,
  ProviderModeSchema,
  ToneSchema,
  ActivityConsentSchema,
} from "@/core/models";
import {
  DEFAULT_BUCKET_NAME,
  validateApiKey,
  validateBotName,
  validateBucketName,
  validateCheckInTime,
  validateOllamaBaseUrl,
  validateOllamaModel,
  validateSupabaseUrl,
} from "@/core/validators";
import { getRepo, initRepo, type Repo } from "@/data/repository";
import { getActiveProfileId, opFor, setEpoch } from "./session";
import type { ServiceResult } from "./profileService";

export type { ServiceResult };

export const SETTINGS_ERRORS = {
  noProfile: "No Profile is selected, so the setting was not saved.",
  notSaved: "The setting was not saved.",
  unavailable: "Local storage is unavailable, so the setting was not saved.",
  tone: "Tone must be cheerful, calm, or playful.",
  providerMode: "Provider mode must be auto, ollama, or gemini.",
  consent: "Activity tracking choice is invalid.",
  namespaceId: "Backup namespace ID must be 22 to 64 letters, digits, hyphens, or underscores.",
  browserRecord: "Backup settings could not be loaded.",
} as const;

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
const fail = (error: string): ServiceResult<never> => ({ ok: false, error });

const nowIso = () => new Date().toISOString();

async function repo(): Promise<Repo> {
  return getRepo() ?? (await initRepo());
}

// ---------------------------------------------------------------------------
// Profile settings
// ---------------------------------------------------------------------------

/** Read-modify-write of one Profile's Settings in a single transaction. */
async function updateSettings(
  patch: Partial<Omit<Settings, "profileId" | "updatedAt">>,
  profileId: string | null,
): Promise<ServiceResult<Settings>> {
  if (!profileId) return fail(SETTINGS_ERRORS.noProfile);
  const r = await repo();
  if (r.mode !== "ready") return fail(SETTINGS_ERRORS.unavailable);

  const res = await r.tx(opFor(profileId), ["settings"], async (t) => {
    const current = await t.get("settings", profileId);
    if (!current) throw new Error("settings missing");
    const next: Settings = { ...current, ...patch, profileId, updatedAt: nowIso() };
    await t.put("settings", next);
    return next;
  });
  return res.ok ? ok(res.value) : fail(SETTINGS_ERRORS.notSaved);
}

/** 2.1, 2.6, 2.7 */
export async function saveBotName(input: string, profileId = getActiveProfileId()): Promise<ServiceResult<Settings>> {
  const v = validateBotName(input);
  if (!v.ok) return fail(v.error);
  return updateSettings({ botName: v.value }, profileId);
}

/** 2.2, 2.7 */
export async function saveTone(tone: Tone, profileId = getActiveProfileId()): Promise<ServiceResult<Settings>> {
  const v = ToneSchema.safeParse(tone);
  if (!v.success) return fail(SETTINGS_ERRORS.tone);
  return updateSettings({ tone: v.data }, profileId);
}

/** 6.2 */
export async function saveProviderMode(
  mode: ProviderMode,
  profileId = getActiveProfileId(),
): Promise<ServiceResult<Settings>> {
  const v = ProviderModeSchema.safeParse(mode);
  if (!v.success) return fail(SETTINGS_ERRORS.providerMode);
  return updateSettings({ providerMode: v.data }, profileId);
}

/** 6.3, 6.14: both values are validated before either is saved. */
export async function saveOllama(
  baseUrl: string,
  model: string,
  profileId = getActiveProfileId(),
): Promise<ServiceResult<Settings>> {
  const url = validateOllamaBaseUrl(baseUrl);
  if (!url.ok) return fail(url.error);
  const m = validateOllamaModel(model);
  if (!m.ok) return fail(m.error);
  return updateSettings({ ollamaBaseUrl: url.value, ollamaModel: m.value }, profileId);
}

/** 12.4, 12.5: `null` clears the override. */
export async function saveCheckInOverride(
  hhmm: string | null,
  profileId = getActiveProfileId(),
): Promise<ServiceResult<Settings>> {
  if (hhmm === null) return updateSettings({ checkInTimeOverride: null }, profileId);
  const v = validateCheckInTime(hhmm);
  if (!v.ok) return fail(v.error);
  return updateSettings({ checkInTimeOverride: v.value }, profileId);
}

/** 11.4: existing Activity_Logs are not touched. */
export async function saveActivityTracking(
  enabled: boolean,
  profileId = getActiveProfileId(),
): Promise<ServiceResult<Settings>> {
  return updateSettings({ activityTrackingEnabled: enabled === true }, profileId);
}

export async function saveNotificationsEnabled(
  enabled: boolean,
  profileId = getActiveProfileId(),
): Promise<ServiceResult<Settings>> {
  return updateSettings({ notificationsEnabled: enabled === true }, profileId);
}

/** 6.21: records when the Gemini_Privacy_Notice was accepted. */
export async function acknowledgeGeminiNotice(profileId = getActiveProfileId()): Promise<ServiceResult<Settings>> {
  return updateSettings({ geminiNoticeAcknowledgedAt: nowIso() }, profileId);
}

/**
 * 11.7, 11.8: stores the disclosure choice and sets tracking in one
 * transaction: enabled for `opt_in`, disabled for `opt_out` and `dismissed`.
 */
export async function saveActivityConsent(
  choice: ActivityConsent,
  profileId = getActiveProfileId(),
): Promise<ServiceResult<{ settings: Settings; meta: ProfileMeta }>> {
  const v = ActivityConsentSchema.safeParse(choice);
  if (!v.success) return fail(SETTINGS_ERRORS.consent);
  if (!profileId) return fail(SETTINGS_ERRORS.noProfile);
  const r = await repo();
  if (r.mode !== "ready") return fail(SETTINGS_ERRORS.unavailable);

  const res = await r.tx(opFor(profileId), ["settings", "profileMeta"], async (t) => {
    const settings = await t.get("settings", profileId);
    const meta = await t.get("profileMeta", profileId);
    if (!settings || !meta) throw new Error("profile records missing");
    const now = nowIso();
    const nextSettings: Settings = { ...settings, activityTrackingEnabled: v.data === "opt_in", updatedAt: now };
    const nextMeta: ProfileMeta = { ...meta, activityConsent: v.data, updatedAt: now };
    await t.put("settings", nextSettings);
    await t.put("profileMeta", nextMeta);
    return { settings: nextSettings, meta: nextMeta };
  });
  return res.ok ? ok(res.value) : fail(SETTINGS_ERRORS.notSaved);
}

// ---------------------------------------------------------------------------
// Browser record (18.1, 18.14, 7.10)
// ---------------------------------------------------------------------------

const BROWSER_KEY = "singleton" as const;
/** 18 random bytes = 144 bits, encoded as 24 base64url characters (18.14). */
const NAMESPACE_BYTES = 18;

/** A fresh Backup_Namespace_ID from `crypto.getRandomValues`, base64url without padding. */
export function generateNamespaceId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(NAMESPACE_BYTES));
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Browser-level writes are not owned by a Profile; tag them with the active one for staleness checks. */
const browserOp = () => opFor(getActiveProfileId() ?? "");

async function updateBrowserRecord(
  patch: Partial<Pick<BrowserRecord, "backupNamespaceId" | "cloudStoreConfig">>,
): Promise<ServiceResult<BrowserRecord>> {
  const r = await repo();
  if (r.mode !== "ready") return fail(SETTINGS_ERRORS.unavailable);
  const res = await r.tx(browserOp(), ["browser"], async (t) => {
    const current = await t.get("browser", BROWSER_KEY);
    const base: BrowserRecord = current ?? {
      id: BROWSER_KEY,
      backupNamespaceId: generateNamespaceId(),
      createdAt: nowIso(),
      epoch: 0,
      cloudStoreConfig: null,
    };
    const next: BrowserRecord = { ...base, ...patch, id: BROWSER_KEY };
    await t.put("browser", next);
    return next;
  });
  return res.ok ? ok(res.value) : fail(SETTINGS_ERRORS.notSaved);
}

/**
 * Loads the browser record, creating it on first start with a new
 * Backup_Namespace_ID, epoch 0, and no Cloud_Store config (18.14). Also
 * publishes the persisted epoch to the session store.
 */
export async function ensureBrowserRecord(): Promise<ServiceResult<BrowserRecord>> {
  const r = await repo();
  if (r.mode === "unavailable") return fail(SETTINGS_ERRORS.browserRecord);

  let existing: BrowserRecord | undefined;
  try {
    existing = await r.getBrowserRecord();
  } catch {
    return fail(SETTINGS_ERRORS.browserRecord);
  }
  if (existing) {
    setEpoch(existing.epoch);
    return ok(existing);
  }
  if (r.mode !== "ready") return fail(SETTINGS_ERRORS.browserRecord);

  const res = await r.tx(browserOp(), ["browser"], async (t) => {
    // Another tab may have created it since the read above.
    const raced = await t.get("browser", BROWSER_KEY);
    if (raced) return raced;
    const rec: BrowserRecord = {
      id: BROWSER_KEY,
      backupNamespaceId: generateNamespaceId(),
      createdAt: nowIso(),
      epoch: 0,
      cloudStoreConfig: null,
    };
    await t.put("browser", rec);
    return rec;
  });
  if (!res.ok) return fail(SETTINGS_ERRORS.browserRecord);
  setEpoch(res.value.epoch);
  return ok(res.value);
}

export interface CloudStoreConfigInput {
  supabaseUrl: string;
  anonKey: string;
  /** Blank uses the default bucket name. */
  bucketName?: string;
}

/** 18.1, 7.5, 7.6: all fields are validated before anything is saved. */
export async function saveCloudStoreConfig(input: CloudStoreConfigInput): Promise<ServiceResult<BrowserRecord>> {
  const url = validateSupabaseUrl(input.supabaseUrl);
  if (!url.ok) return fail(url.error);
  const key = validateApiKey(input.anonKey);
  if (!key.ok) return fail(key.error);
  const rawBucket = (input.bucketName ?? "").trim();
  const bucket = validateBucketName(rawBucket === "" ? DEFAULT_BUCKET_NAME : rawBucket);
  if (!bucket.ok) return fail(bucket.error);

  const cloudStoreConfig: CloudStoreConfig = {
    supabaseUrl: url.value,
    supabaseAnonKey: key.value,
    bucketName: bucket.value,
  };
  return updateBrowserRecord({ cloudStoreConfig });
}

/** 7.10: removes the anon key (and the rest of the Cloud_Store config). */
export async function clearCloudStoreConfig(): Promise<ServiceResult<BrowserRecord>> {
  return updateBrowserRecord({ cloudStoreConfig: null });
}

/** 18.14: replaces the Backup_Namespace_ID with a user-entered one. */
export async function replaceNamespaceId(id: string): Promise<ServiceResult<BrowserRecord>> {
  const v = BackupNamespaceId.safeParse(id.trim());
  if (!v.success) return fail(SETTINGS_ERRORS.namespaceId);
  return updateBrowserRecord({ backupNamespaceId: v.data });
}

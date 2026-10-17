/**
 * Backup_Service (Req 7.2, 7.3, 7.7–7.9, 7.14, 18.2, 18.4–18.13, 18.15–18.18,
 * 20.16, 20.27, 20.29).
 *
 * - Cloud backups are encrypted (`encryptBackup`) and uploaded to Supabase
 *   Storage under `{backupNamespaceId}/backup-{yyyyMMddTHHmmssSSSZ}-{rand6}.acb`.
 * - Every Cloud_Store call goes through one Supabase client whose custom fetch
 *   only reaches the configured project origin and aborts after 30 s.
 * - Guards (no Local_Store, offline, unconfigured, no key, passphrase length)
 *   return before any client is created, so they send zero requests.
 * - Restore and import replace all profile-data stores in one transaction,
 *   clear `checkIns`, keep `browser` / `backupMeta`, then bump the epoch.
 * - Every message returned to the UI passes through `redactSecrets` with the
 *   anon key (and passphrase, when one is in play). Nothing here logs.
 *
 * The passphrase only lives in function locals for one operation (18.18).
 * Browser-only at call time; importing the module is SSR-safe.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MAX_BACKUP_BYTES,
  parseBackup,
  serializeBackup,
  type BackupData,
  type BackupError,
  type Result,
} from "@/core/backup";
import { decryptBackup, encryptBackup, HEADER_LEN } from "@/core/crypto";
import {
  DEFAULT_BUCKET_NAME,
  SCHEMA_VERSION,
  toTimestamp,
  type BackupMeta,
  type BrowserRecord,
  type CloudStoreConfig,
  type StoreName,
} from "@/core/models";
import { redactSecrets } from "@/core/secrets";
import { validatePassphrase } from "@/core/validators";
import { getRepo, type OperationContext, type Repo, type RepoError } from "@/data/repository";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BackupServiceErrorKind =
  | "unavailable"
  | "offline"
  | "not_configured"
  | "no_key"
  | "passphrase_length"
  | "key_rejected"
  | "bucket_not_found"
  | "not_found"
  | "timeout"
  | "cloud_error"
  | "decrypt_failed"
  | "invalid_backup"
  | "store_failed";

export interface BackupServiceError {
  kind: BackupServiceErrorKind;
  /** User-facing text, already redacted. */
  message: string;
  /** Present when `kind === "invalid_backup"`. */
  backupError?: BackupError;
}

export type ServiceResult<T> = Result<T, BackupServiceError>;

export interface CloudBackupEntry {
  /** Object name relative to the namespace prefix (pass to `restoreFromCloud`). */
  name: string;
  createdAt: string;
  sizeBytes: number;
}

export interface CloudBackupResult {
  name: string;
  meta: BackupMeta;
}

export interface ExportResult {
  fileName: string;
  sizeBytes: number;
}

export interface RestoreResult {
  profileCount: number;
  /** The browser epoch after the restore. */
  epoch: number;
}

export interface RestoreAppliedEvent extends RestoreResult {
  source: "cloud" | "file";
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Cloud_Store request timeout (18.5, 18.9, 18.12). */
export const CLOUD_TIMEOUT_MS = 30_000;
/** Max entries returned by `listCloudBackups` (18.6). */
export const LIST_LIMIT = 50;

const GCM_TAG_LEN = 16;
const OCTET_STREAM = "application/octet-stream";

/** `backup-{yyyyMMddTHHmmssSSSZ}-{rand6}.acb` */
const BACKUP_NAME_RE = /^backup-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-[a-z0-9]{6}\.acb$/;
const RAND_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** Stores replaced by a restore; parents first so the refill satisfies references (18.8, 19.14). */
const RESTORE_STORES: StoreName[] = [
  "profiles",
  "settings",
  "chats",
  "messages",
  "memories",
  "activityLogs",
  "summaries",
  "profileMeta",
  "checkIns",
];

/** `backupMeta` and `browser` are unscoped, so any profileId works for the op (20.8). */
const BROWSER_OP_PROFILE = "browser";

const MESSAGES = {
  unavailable: "Local storage isn't available, so backups can't run right now.",
  offline: "You're offline. Backup and restore will be available again when you reconnect.",
  not_configured: "Cloud storage is not configured. Open Cloud backup settings to add your Supabase details.",
  no_key: "No Supabase anon key is saved. Enter your anon key in Cloud backup settings first.",
  key_rejected: "Supabase rejected the API key. Check the anon key in Settings.",
  timeout: "The request to Supabase timed out after 30 seconds. Please try again.",
  decrypt_failed: "Passphrase is incorrect or the backup is corrupted.",
  not_found: "That backup could not be found in cloud storage.",
  network: "Couldn't reach Supabase. Check your connection and the project URL in Settings.",
  rls: "Supabase blocked the request with a Row Level Security policy. Make sure the bucket's storage policies allow access to objects under your backup namespace.",
} as const;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });

function fail(
  kind: BackupServiceErrorKind,
  message: string,
  secrets: readonly string[] = [],
  backupError?: BackupError,
): ServiceResult<never> {
  const error: BackupServiceError = { kind, message: redactSecrets(message, secrets) };
  if (backupError) error.backupError = backupError;
  return { ok: false, error };
}

const isOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;

/** `2024-05-01T13:45:00.123Z` → `20240501T134500123Z` */
const compactTimestamp = (iso: string) => iso.replace(/[-:.]/g, "");

function rand6(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (b) => RAND_ALPHABET[b % RAND_ALPHABET.length]).join("");
}

/** Recovers the timestamp encoded in a backup object name. */
function timestampFromName(name: string): string | null {
  const m = BACKUP_NAME_RE.exec(name);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, ms] = m;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${s}.${ms}Z`;
  return Number.isFinite(Date.parse(iso)) ? iso : null;
}

/** Canonical JSON sorts keys, so `checksum` is always the first key of the document. */
function checksumFromDocument(text: string): string {
  const m = /^\{\s*"checksum":\s*"([0-9a-f]+)"/.exec(text);
  return m?.[1] ?? "";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/** Readable text for each Backup_Serializer failure category (17.4–17.6, 20.27). */
export function backupErrorMessage(e: BackupError): string {
  switch (e.kind) {
    case "too_large":
      return "This backup is larger than the 50 MB limit.";
    case "invalid_json":
      return "The backup is unreadable: it isn't a valid backup file.";
    case "unsupported_schema":
      return "This backup uses a schema version this app doesn't support. It may come from a newer version of the app.";
    case "checksum_mismatch":
      return "The backup is damaged: its checksum doesn't match its data.";
    case "missing_field":
      return `The backup is missing required data (${e.field}).`;
    case "missing_parent":
      return `The backup is missing data: a ${e.recordType} record refers to "${e.ref}", which isn't in the backup.`;
    case "too_many_profiles":
      return "A backup may contain at most 3 Profiles.";
  }
}

function repoErrorMessage(e: RepoError): string {
  switch (e.kind) {
    case "stale":
      return "Data changed while restoring, so nothing was replaced. Please try again.";
    case "read_only":
      return "Local storage is read-only right now, so nothing was replaced.";
    case "validation":
      return `The backup couldn't be saved: a ${e.model} record is invalid. Nothing was replaced.`;
    case "write_failed":
      return "Couldn't write to local storage. Nothing was replaced.";
  }
}

// ---------------------------------------------------------------------------
// Restore notifications (Tab_Coordinator / session wiring subscribes here)
// ---------------------------------------------------------------------------

const restoreListeners = new Set<(e: RestoreAppliedEvent) => void>();

/** Called after a restore or import replaced the Local_Store (20.29). */
export function onRestoreApplied(listener: (e: RestoreAppliedEvent) => void): () => void {
  restoreListeners.add(listener);
  return () => void restoreListeners.delete(listener);
}

function emitRestore(e: RestoreAppliedEvent) {
  for (const l of [...restoreListeners]) {
    try {
      l(e);
    } catch {
      // A failing listener must not undo or mask a completed restore.
    }
  }
}

// ---------------------------------------------------------------------------
// Data collection
// ---------------------------------------------------------------------------

/** Gathers every profile-data record across all Profiles (17.1). */
export async function collectBackupData(repo: Repo): Promise<BackupData> {
  const profiles = await repo.getProfiles();
  const data: BackupData = {
    profiles,
    settings: [],
    chats: [],
    messages: [],
    memories: [],
    activityLogs: [],
    summaries: [],
    profileMeta: [],
  };
  for (const p of profiles) {
    const [settings, chats, memories, activity, summary, meta] = await Promise.all([
      repo.getSettings(p.id),
      repo.listChats(p.id),
      repo.memoriesByProfile(p.id),
      repo.activityByProfile(p.id),
      repo.getSummary(p.id),
      repo.getProfileMeta(p.id),
    ]);
    if (settings) data.settings.push(settings);
    if (summary) data.summaries.push(summary);
    if (meta) data.profileMeta.push(meta);
    data.chats.push(...chats);
    data.memories.push(...memories);
    data.activityLogs.push(...activity);
    for (const c of chats) data.messages.push(...(await repo.messagesByChat(c.id)));
  }
  return data;
}

// ---------------------------------------------------------------------------
// Supabase client
// ---------------------------------------------------------------------------

interface TimeoutState {
  hit: boolean;
}

interface CachedClient {
  url: string;
  key: string;
  client: SupabaseClient;
  timeout: TimeoutState;
}

let cached: CachedClient | null = null;

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

/** One client per (url, key); recreated when either changes. */
async function getClient(config: CloudStoreConfig): Promise<CachedClient> {
  if (cached && cached.url === config.supabaseUrl && cached.key === config.supabaseAnonKey) return cached;

  const { createClient } = await import("@supabase/supabase-js");
  const origin = new URL(config.supabaseUrl).origin;
  const timeout: TimeoutState = { hit: false };

  // The only place requests leave for the Cloud_Store: same origin only (7.2), 30 s cap.
  const guardedFetch: typeof fetch = (input, init) => {
    let target: URL;
    try {
      target = new URL(requestUrl(input), origin);
    } catch {
      return Promise.reject(new TypeError("Invalid Cloud_Store request URL"));
    }
    if (target.origin !== origin) {
      return Promise.reject(new TypeError("Blocked a request outside the configured Supabase project URL"));
    }
    const timer = AbortSignal.timeout(CLOUD_TIMEOUT_MS);
    const signal = init?.signal ? AbortSignal.any([init.signal, timer]) : timer;
    return fetch(input, { ...init, signal }).catch((err: unknown) => {
      if (timer.aborted) timeout.hit = true;
      throw err;
    });
  };

  const client = createClient(config.supabaseUrl, config.supabaseAnonKey, {
    global: { fetch: guardedFetch },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  cached = { url: config.supabaseUrl, key: config.supabaseAnonKey, client, timeout };
  return cached;
}

interface CloudContext {
  repo: Repo;
  browser: BrowserRecord;
  config: CloudStoreConfig;
  client: SupabaseClient;
  timeout: TimeoutState;
  secrets: string[];
}

/** Every guard runs before a client exists, so a failed guard sends zero requests. */
async function prepareCloud(repo: Repo | null, passphrase?: string): Promise<ServiceResult<CloudContext>> {
  if (!repo || repo.mode !== "ready") return fail("unavailable", MESSAGES.unavailable);
  if (isOffline()) return fail("offline", MESSAGES.offline);

  const browser = await repo.getBrowserRecord();
  const config = browser?.cloudStoreConfig ?? null;
  if (!browser || !config || !config.supabaseUrl || !config.bucketName) {
    return fail("not_configured", MESSAGES.not_configured);
  }
  if (!config.supabaseAnonKey) return fail("no_key", MESSAGES.no_key);

  const secrets = [config.supabaseAnonKey];
  if (passphrase !== undefined) {
    const v = validatePassphrase(passphrase);
    if (!v.ok) return fail("passphrase_length", v.error, secrets);
    secrets.push(passphrase);
  }

  const { client, timeout } = await getClient(config);
  timeout.hit = false;
  return ok({ repo, browser, config, client, timeout, secrets });
}

interface ErrorFacts {
  status: number | undefined;
  code: string;
  message: string;
  name: string;
}

function factsOf(e: unknown): ErrorFacts {
  const facts: ErrorFacts = { status: undefined, code: "", message: "", name: "" };
  if (!isRecord(e)) {
    facts.message = e === undefined || e === null ? "" : String(e);
    return facts;
  }
  facts.message = typeof e.message === "string" ? e.message : "";
  facts.name = typeof e.name === "string" ? e.name : "";
  facts.code = typeof e.code === "string" ? e.code : "";
  if (typeof e.status === "number") facts.status = e.status;
  else if (typeof e.statusCode === "string" && /^\d{3}$/.test(e.statusCode)) facts.status = Number(e.statusCode);
  const orig = e.originalError;
  if (isRecord(orig)) {
    if (facts.status === undefined && typeof orig.status === "number") facts.status = orig.status;
    if (typeof orig.name === "string" && (orig.name === "TimeoutError" || orig.name === "TypeError")) {
      facts.name = orig.name;
    }
  }
  return facts;
}

/** Maps a Supabase Storage failure to a user-facing error (7.7, 18.5, 18.9, 18.12). */
function cloudError(e: unknown, ctx: CloudContext): ServiceResult<never> {
  const f = factsOf(e);
  const s = ctx.secrets;
  if (ctx.timeout.hit || f.name === "TimeoutError") return fail("timeout", MESSAGES.timeout, s);

  if (/row-level security/i.test(f.message)) return fail("cloud_error", MESSAGES.rls, s);
  if (
    f.status === 401 ||
    f.status === 403 ||
    /invalid jwt|jws|jwt (expired|malformed)|signature|invalid api key|unauthorized/i.test(f.message)
  ) {
    return fail("key_rejected", MESSAGES.key_rejected, s);
  }
  if (/bucket not found/i.test(f.message) || f.code === "NoSuchBucket") {
    const bucket = ctx.config.bucketName;
    const msg =
      bucket === DEFAULT_BUCKET_NAME
        ? `The storage bucket "${DEFAULT_BUCKET_NAME}" was not found. Create a bucket named "${DEFAULT_BUCKET_NAME}" in Supabase Storage.`
        : `The storage bucket "${bucket}" was not found. Create it in Supabase Storage, or create a bucket named "${DEFAULT_BUCKET_NAME}" and use that name in Settings.`;
    return fail("bucket_not_found", msg, s);
  }
  if (f.status === 404 || f.code === "NoSuchKey" || /object not found|not found/i.test(f.message)) {
    return fail("not_found", MESSAGES.not_found, s);
  }
  if (f.name === "TypeError" || /failed to fetch|networkerror|load failed/i.test(f.message)) {
    return fail("cloud_error", MESSAGES.network, s);
  }
  const detail = f.message || "unknown error";
  const status = f.status !== undefined ? ` (HTTP ${f.status})` : "";
  return fail("cloud_error", `Supabase Storage returned an error${status}: ${detail}`, s);
}

// ---------------------------------------------------------------------------
// Cloud backup
// ---------------------------------------------------------------------------

/** Encrypts and uploads a backup, then records its Backup_Metadata (18.2, 18.15). */
export async function backupToCloud(
  passphrase: string,
  repo: Repo | null = getRepo(),
): Promise<ServiceResult<CloudBackupResult>> {
  const prep = await prepareCloud(repo, passphrase);
  if (!prep.ok) return prep;
  const ctx = prep.value;
  const { browser, config, client } = ctx;

  let text: string;
  let profileCount: number;
  const createdAt = toTimestamp(Date.now());
  try {
    const data = await collectBackupData(ctx.repo);
    profileCount = data.profiles.length;
    text = await serializeBackup(data, createdAt);
  } catch {
    return fail("store_failed", "Couldn't read your data from local storage.", ctx.secrets);
  }
  const plain = new TextEncoder().encode(text);
  if (plain.byteLength > MAX_BACKUP_BYTES) {
    return fail("invalid_backup", backupErrorMessage({ kind: "too_large" }), ctx.secrets, { kind: "too_large" });
  }

  const encrypted = await encryptBackup(plain, passphrase);
  const name = `backup-${compactTimestamp(createdAt)}-${rand6()}.acb`;
  const path = `${browser.backupNamespaceId}/${name}`;
  // encryptBackup returns an ArrayBuffer-backed array.
  const body = new Blob([encrypted as Uint8Array<ArrayBuffer>], { type: OCTET_STREAM });

  try {
    const { error } = await client.storage
      .from(config.bucketName)
      .upload(path, body, { contentType: OCTET_STREAM, upsert: false });
    if (error) return cloudError(error, ctx);
  } catch (err) {
    return cloudError(err, ctx);
  }

  const meta: BackupMeta = {
    id: name,
    createdAt,
    schemaVersion: SCHEMA_VERSION,
    profileCount,
    sizeBytes: encrypted.byteLength,
    checksum: checksumFromDocument(text) || "unknown",
    location: "cloud",
  };
  const op: OperationContext = { profileId: BROWSER_OP_PROFILE, epoch: browser.epoch };
  const saved = await ctx.repo.put(op, "backupMeta", meta);
  if (!saved.ok) {
    return fail(
      "store_failed",
      "The backup was uploaded, but its details couldn't be saved on this device.",
      ctx.secrets,
    );
  }
  return ok({ name, meta });
}

/** Up to 50 backups under the namespace prefix, newest first (18.6, 18.12). */
export async function listCloudBackups(repo: Repo | null = getRepo()): Promise<ServiceResult<CloudBackupEntry[]>> {
  const prep = await prepareCloud(repo);
  if (!prep.ok) return prep;
  const ctx = prep.value;

  try {
    const { data, error } = await ctx.client.storage
      .from(ctx.config.bucketName)
      .list(ctx.browser.backupNamespaceId, { limit: LIST_LIMIT, sortBy: { column: "name", order: "desc" } });
    if (error) return cloudError(error, ctx);
    const entries: CloudBackupEntry[] = [];
    for (const f of data ?? []) {
      const fromName = timestampFromName(f.name);
      if (!fromName) continue; // folders, placeholders, foreign objects
      const size = isRecord(f.metadata) ? f.metadata.size : undefined;
      entries.push({
        name: f.name,
        createdAt: f.created_at ?? fromName,
        sizeBytes: typeof size === "number" && Number.isFinite(size) ? size : 0,
      });
    }
    return ok(entries);
  } catch (err) {
    return cloudError(err, ctx);
  }
}

/**
 * Downloads, decrypts, validates, and applies a cloud backup (18.8, 18.9, 18.17).
 * The caller must have shown the replace-all confirmation first (18.7).
 */
export async function restoreFromCloud(
  name: string,
  passphrase: string,
  repo: Repo | null = getRepo(),
): Promise<ServiceResult<RestoreResult>> {
  const prep = await prepareCloud(repo, passphrase);
  if (!prep.ok) return prep;
  const ctx = prep.value;
  if (!BACKUP_NAME_RE.test(name)) return fail("not_found", MESSAGES.not_found, ctx.secrets);

  let blob: Blob;
  try {
    const { data, error } = await ctx.client.storage
      .from(ctx.config.bucketName)
      .download(`${ctx.browser.backupNamespaceId}/${name}`);
    if (error) return cloudError(error, ctx);
    if (!data) return fail("not_found", MESSAGES.not_found, ctx.secrets);
    blob = data;
  } catch (err) {
    return cloudError(err, ctx);
  }

  if (blob.size > MAX_BACKUP_BYTES + HEADER_LEN + GCM_TAG_LEN) {
    return fail("invalid_backup", backupErrorMessage({ kind: "too_large" }), ctx.secrets, { kind: "too_large" });
  }

  let encrypted: Uint8Array;
  try {
    encrypted = new Uint8Array(await blob.arrayBuffer());
  } catch (err) {
    return cloudError(err, ctx);
  }

  const decrypted = await decryptBackup(encrypted, passphrase);
  if (!decrypted.ok) return fail("decrypt_failed", MESSAGES.decrypt_failed, ctx.secrets);

  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(decrypted.value);
  } catch {
    return fail("invalid_backup", backupErrorMessage({ kind: "invalid_json" }), ctx.secrets, {
      kind: "invalid_json",
    });
  }

  const parsed = await parseBackup(text, decrypted.value.byteLength);
  if (!parsed.ok) return fail("invalid_backup", backupErrorMessage(parsed.error), ctx.secrets, parsed.error);

  return applyRestoreFrom(parsed.value, ctx.repo, "cloud", ctx.secrets);
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

/**
 * Replaces all profile-data stores with `data` in one transaction, clears
 * `checkIns`, leaves `browser` / `backupMeta` alone, then bumps the epoch
 * (18.8, 19.14, 20.29). The caller must confirm with the user first (18.7).
 */
export function applyRestore(data: BackupData, repo: Repo | null = getRepo()): Promise<ServiceResult<RestoreResult>> {
  return applyRestoreFrom(data, repo, "file", []);
}

async function applyRestoreFrom(
  data: BackupData,
  repo: Repo | null,
  source: RestoreAppliedEvent["source"],
  secrets: readonly string[],
): Promise<ServiceResult<RestoreResult>> {
  if (!repo || repo.mode !== "ready") return fail("unavailable", MESSAGES.unavailable, secrets);

  const before = await repo.getBrowserRecord();
  const op: OperationContext = { profileId: BROWSER_OP_PROFILE, epoch: before?.epoch ?? 0 };

  const replaced = await repo.clearStores(op, RESTORE_STORES, async (t) => {
    for (const r of data.profiles) await t.put("profiles", r);
    for (const r of data.settings) await t.put("settings", r);
    for (const r of data.chats) await t.put("chats", r);
    for (const r of data.messages) await t.put("messages", r);
    for (const r of data.memories) await t.put("memories", r);
    for (const r of data.activityLogs) await t.put("activityLogs", r);
    for (const r of data.summaries) await t.put("summaries", r);
    for (const r of data.profileMeta) await t.put("profileMeta", r);
  });
  if (!replaced.ok) return fail("store_failed", repoErrorMessage(replaced.error), secrets);

  // Bump the epoch so results of operations started before the restore are discarded (20.29).
  let epoch = op.epoch;
  const current = (await repo.getBrowserRecord()) ?? before;
  if (current) {
    const next: BrowserRecord = { ...current, epoch: current.epoch + 1 };
    const bumped = await repo.put({ profileId: BROWSER_OP_PROFILE, epoch: current.epoch }, "browser", next);
    epoch = bumped.ok ? next.epoch : current.epoch;
  }

  const result: RestoreResult = { profileCount: data.profiles.length, epoch };
  emitRestore({ ...result, source });
  return ok(result);
}

// ---------------------------------------------------------------------------
// Local file export / import
// ---------------------------------------------------------------------------

/** Downloads the plaintext Backup_Document as a JSON file (18.10). */
export async function exportToFile(repo: Repo | null = getRepo()): Promise<ServiceResult<ExportResult>> {
  if (!repo || repo.mode !== "ready") return fail("unavailable", MESSAGES.unavailable);
  if (typeof document === "undefined" || typeof URL.createObjectURL !== "function") {
    return fail("unavailable", "File export isn't available in this browser.");
  }

  const createdAt = toTimestamp(Date.now());
  let text: string;
  let profileCount: number;
  try {
    const data = await collectBackupData(repo);
    profileCount = data.profiles.length;
    text = await serializeBackup(data, createdAt);
  } catch {
    return fail("store_failed", "Couldn't read your data from local storage.");
  }

  const blob = new Blob([text], { type: "application/json" });
  const fileName = `companion-backup-${compactTimestamp(createdAt)}.json`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Give the browser time to start the download before releasing the blob.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  // Best effort: a missing metadata record doesn't undo a completed download.
  const browser = await repo.getBrowserRecord();
  const meta: BackupMeta = {
    id: fileName,
    createdAt,
    schemaVersion: SCHEMA_VERSION,
    profileCount,
    sizeBytes: blob.size,
    checksum: checksumFromDocument(text) || "unknown",
    location: "file",
  };
  await repo.put({ profileId: BROWSER_OP_PROFILE, epoch: browser?.epoch ?? 0 }, "backupMeta", meta);

  return ok({ fileName, sizeBytes: blob.size });
}

/**
 * Reads and validates a local Backup_Document (≤ 50 MB) without touching the
 * Local_Store (18.11). After the user confirms, pass the result to `applyRestore`.
 */
export async function importFromFile(file: Blob): Promise<ServiceResult<BackupData>> {
  if (file.size > MAX_BACKUP_BYTES) {
    return fail("invalid_backup", backupErrorMessage({ kind: "too_large" }), [], { kind: "too_large" });
  }
  let text: string;
  try {
    text = await file.text();
  } catch {
    return fail("invalid_backup", backupErrorMessage({ kind: "invalid_json" }), [], { kind: "invalid_json" });
  }
  const parsed = await parseBackup(text, file.size);
  if (!parsed.ok) return fail("invalid_backup", backupErrorMessage(parsed.error), [], parsed.error);
  return ok(parsed.value);
}

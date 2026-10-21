/**
 * Backup_Serializer (Req 17, 19.14, 19.15, 20.27).
 *
 * A Backup_Document is canonical JSON of the shape
 * `{ checksum, exportedAt, schemaVersion, data }`:
 * - Keys are sorted lexicographically at every level and the output is
 *   indented with 2 spaces (17.7).
 * - Every collection is sorted by `id` (settings, summaries, and profileMeta
 *   by `profileId`), so equal datasets serialize to identical bytes.
 * - `checksum` is the SHA-256 hex digest of the canonical serialization of
 *   `{ exportedAt, schemaVersion, data }` (17.1).
 *
 * Only the profile-data stores are included. The browser record (with
 * `cloudStoreConfig` / anon key), `checkIns`, and `backupMeta` are never part of
 * a backup, and each record is reduced to the fields its schema defines, so no
 * stray secret can ride along (7.9, 17.2, 19.14, 19.15).
 *
 * This module is pure apart from Web Crypto (`globalThis.crypto.subtle`).
 */
import { z } from "zod";
import {
  ActivityLogSchema,
  ChatSchema,
  MemorySchema,
  MessageSchema,
  ProfileMetaSchema,
  ProfileSchema,
  SCHEMA_VERSION,
  SettingsSchema,
  SummarySchema,
  Timestamp,
  type ActivityLog,
  type Chat,
  type Memory,
  type Message,
  type Profile,
  type ProfileMeta,
  type Settings,
  type Summary,
} from "@/core/models";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BackupData {
  profiles: Profile[];
  settings: Settings[];
  chats: Chat[];
  messages: Message[];
  memories: Memory[];
  activityLogs: ActivityLog[];
  summaries: Summary[];
  profileMeta: ProfileMeta[];
}

export type BackupError =
  | { kind: "too_large" }
  | { kind: "invalid_json" }
  | { kind: "unsupported_schema" }
  | { kind: "checksum_mismatch" }
  | { kind: "missing_field"; field: string }
  | { kind: "missing_parent"; recordType: string; ref: string }
  | { kind: "too_many_profiles" };

export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };

/** Maximum accepted Backup_Document size in bytes (17.6, 18.11). */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

/** Maximum number of Profiles a backup may hold (1.1, 20.27). */
export const MAX_BACKUP_PROFILES = 3;

/**
 * Schema versions this build can read. Newer versions are rejected (17.4, 20.27).
 * Version 3 added optional Message `channel`/`callId` (missing → "text").
 * Version 2 only added the `reminders` store, which is not backed up, so the
 * `data` sections of v1 and v2 documents are identical.
 */
export const SUPPORTED_SCHEMA_VERSIONS: readonly number[] = [1, 2, SCHEMA_VERSION];

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

type SectionName = keyof BackupData;

interface SectionSpec {
  name: SectionName;
  schema: z.ZodTypeAny;
  sortKey: "id" | "profileId";
}

/** Fixed section order: parents before children, used for validation order. */
const SECTIONS: readonly SectionSpec[] = [
  { name: "profiles", schema: ProfileSchema, sortKey: "id" },
  { name: "settings", schema: SettingsSchema, sortKey: "profileId" },
  { name: "chats", schema: ChatSchema, sortKey: "id" },
  { name: "messages", schema: MessageSchema, sortKey: "id" },
  { name: "memories", schema: MemorySchema, sortKey: "id" },
  { name: "activityLogs", schema: ActivityLogSchema, sortKey: "id" },
  { name: "summaries", schema: SummarySchema, sortKey: "profileId" },
  { name: "profileMeta", schema: ProfileMetaSchema, sortKey: "profileId" },
];

/** Field names defined by a (possibly refined) object schema, in declaration order. */
function shapeKeys(schema: z.ZodTypeAny): string[] {
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodEffects) s = s.innerType();
  if (!(s instanceof z.ZodObject)) throw new Error("Backup section schema must be an object schema");
  return Object.keys(s.shape as Record<string, unknown>);
}

const SECTION_KEYS: Record<SectionName, string[]> = Object.fromEntries(
  SECTIONS.map((sec) => [sec.name, shapeKeys(sec.schema)]),
) as Record<SectionName, string[]>;

/** Keys that must be present (optional fields, e.g. Message `channel`, may be absent in older documents). */
function requiredKeys(schema: z.ZodTypeAny): string[] {
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodEffects) s = s.innerType();
  const shape = (s as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>;
  return Object.keys(shape).filter((k) => !shape[k]!.isOptional());
}

const REQUIRED_KEYS: Record<SectionName, string[]> = Object.fromEntries(
  SECTIONS.map((sec) => [sec.name, requiredKeys(sec.schema)]),
) as Record<SectionName, string[]>;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);

/** Keeps only the listed keys that are present on `rec` (unknown fields are dropped). */
function pick(rec: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((k) => hasOwn(rec, k)).map((k) => [k, rec[k]]));
}

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------
// Canonical JSON and checksum
// ---------------------------------------------------------------------------

/** Recursively sorts object keys (code-unit order). Arrays keep their order. */
export function sortKeysDeep(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeysDeep);
  if (isRecord(v)) {
    // Object.fromEntries defines own properties, so a "__proto__" key stays data.
    return Object.fromEntries(
      Object.keys(v)
        .sort(compareStrings)
        .filter((k) => v[k] !== undefined)
        .map((k) => [k, sortKeysDeep(v[k])]),
    );
  }
  return v;
}

/** `JSON.stringify(sortKeysDeep(v), null, 2)`. */
export const canonicalJson = (v: unknown): string => JSON.stringify(sortKeysDeep(v), null, 2);

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const checksumOf = (payload: { exportedAt: unknown; schemaVersion: unknown; data: unknown }) =>
  sha256Hex(canonicalJson({ exportedAt: payload.exportedAt, schemaVersion: payload.schemaVersion, data: payload.data }));

/** Reduces records to schema fields and sorts every collection deterministically. */
function normalizeData(data: BackupData): BackupData {
  const out = {} as Record<SectionName, Record<string, unknown>[]>;
  for (const { name, sortKey } of SECTIONS) {
    const keys = SECTION_KEYS[name];
    out[name] = (data[name] as unknown as Record<string, unknown>[])
      .map((rec) => pick(rec, keys))
      .sort((a, b) => compareStrings(String(a[sortKey]), String(b[sortKey])));
  }
  return out as unknown as BackupData;
}

// ---------------------------------------------------------------------------
// Serialize
// ---------------------------------------------------------------------------

/** Serializes `data` into a canonical Backup_Document string (17.1, 17.2, 17.7). */
export async function serializeBackup(data: BackupData, exportedAt: string): Promise<string> {
  const payload = { exportedAt, schemaVersion: SCHEMA_VERSION, data: normalizeData(data) };
  const checksum = await checksumOf(payload);
  return canonicalJson({ checksum, ...payload });
}

// ---------------------------------------------------------------------------
// Parse
// ---------------------------------------------------------------------------

const fail = (error: BackupError): Result<never, BackupError> => ({ ok: false, error });

const formatPath = (base: string, path: readonly (string | number)[]) =>
  path.reduce<string>((acc, p) => (typeof p === "number" ? `${acc}[${p}]` : `${acc}.${p}`), base);

/** Validates every section; returns the first missing/invalid field in section → record → field order. */
function validateSections(raw: unknown): Result<BackupData, BackupError> {
  if (!isRecord(raw)) return fail({ kind: "missing_field", field: "data" });
  const out = {} as Record<SectionName, unknown[]>;
  for (const { name, schema } of SECTIONS) {
    const section = raw[name];
    if (!Array.isArray(section)) return fail({ kind: "missing_field", field: `data.${name}` });
    const keys = SECTION_KEYS[name];
    const parsed: unknown[] = [];
    for (let i = 0; i < section.length; i++) {
      const base = `data.${name}[${i}]`;
      const rec: unknown = section[i];
      if (!isRecord(rec)) return fail({ kind: "missing_field", field: base });
      const missing = REQUIRED_KEYS[name].find((k) => !hasOwn(rec, k));
      if (missing !== undefined) return fail({ kind: "missing_field", field: `${base}.${missing}` });
      const r = schema.safeParse(pick(rec, keys));
      if (!r.success) {
        const issue = r.error.issues[0];
        return fail({ kind: "missing_field", field: formatPath(base, issue?.path ?? []) });
      }
      parsed.push(r.data);
    }
    out[name] = parsed;
  }
  return { ok: true, value: out as unknown as BackupData };
}

/** Every parent reference must point at a record in the same document (17.5). */
function checkReferences(d: BackupData): BackupError | null {
  const profileIds = new Set(d.profiles.map((p) => p.id));
  const chatIds = new Set(d.chats.map((c) => c.id));
  const messageIds = new Set(d.messages.map((m) => m.id));
  const missing = (recordType: string, ref: string): BackupError => ({ kind: "missing_parent", recordType, ref });

  for (const s of d.settings) if (!profileIds.has(s.profileId)) return missing("Settings", s.profileId);
  for (const c of d.chats) if (!profileIds.has(c.profileId)) return missing("Chat", c.profileId);
  for (const m of d.messages) {
    if (!profileIds.has(m.profileId)) return missing("Message", m.profileId);
    if (!chatIds.has(m.chatId)) return missing("Message", m.chatId);
  }
  for (const m of d.memories) {
    if (!profileIds.has(m.profileId)) return missing("Memory", m.profileId);
    for (const id of m.sourceChatIds) if (!chatIds.has(id)) return missing("Memory", id);
    for (const id of m.sourceMessageIds) if (!messageIds.has(id)) return missing("Memory", id);
  }
  for (const a of d.activityLogs) if (!profileIds.has(a.profileId)) return missing("Activity_Log", a.profileId);
  for (const s of d.summaries) if (!profileIds.has(s.profileId)) return missing("Profile_Summary", s.profileId);
  for (const m of d.profileMeta) if (!profileIds.has(m.profileId)) return missing("ProfileMeta", m.profileId);
  return null;
}

/**
 * Parses a Backup_Document. Checks run in this order: size (before parsing),
 * JSON, schema version, checksum, required fields, referential integrity,
 * profile count (17.3–17.6, 20.27). Never touches the Local_Store.
 */
export async function parseBackup(text: string, byteLength: number): Promise<Result<BackupData, BackupError>> {
  if (byteLength > MAX_BACKUP_BYTES) return fail({ kind: "too_large" });

  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return fail({ kind: "invalid_json" });
  }
  if (!isRecord(doc)) return fail({ kind: "unsupported_schema" });

  const version = doc.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || !SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
    return fail({ kind: "unsupported_schema" });
  }

  const expected = await checksumOf({ exportedAt: doc.exportedAt, schemaVersion: version, data: doc.data });
  if (typeof doc.checksum !== "string" || doc.checksum !== expected) return fail({ kind: "checksum_mismatch" });

  if (!hasOwn(doc, "exportedAt")) return fail({ kind: "missing_field", field: "exportedAt" });
  if (!Timestamp.safeParse(doc.exportedAt).success) return fail({ kind: "missing_field", field: "exportedAt" });
  if (!hasOwn(doc, "data")) return fail({ kind: "missing_field", field: "data" });

  const sections = validateSections(doc.data);
  if (!sections.ok) return sections;

  const refError = checkReferences(sections.value);
  if (refError) return fail(refError);

  if (sections.value.profiles.length > MAX_BACKUP_PROFILES) return fail({ kind: "too_many_profiles" });

  return { ok: true, value: sections.value };
}

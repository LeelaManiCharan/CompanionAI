/**
 * Data models (Req 19). Every record written to IndexedDB is validated against
 * one of these zod schemas (19.10), and backups are parsed with them.
 *
 * Conventions:
 * - "Characters" are counted as UTF-16 code units (`string.length`), matching
 *   the browser's `maxLength` attribute and live counters.
 * - "Empty" optional values are `null` for timestamps / times and `""` for the
 *   Ollama URL / model strings.
 * - Text fields that the requirements bound "after trimming" are stored trimmed.
 *
 * This module is pure: no DOM, no IndexedDB.
 */
import { z } from "zod";

/** IndexedDB database version === schema version (16.3). */
export const SCHEMA_VERSION = 3;

// ---------------------------------------------------------------------------
// Primitive field schemas
// ---------------------------------------------------------------------------

/**
 * UTC date-time with millisecond precision and `Z` suffix (19.13), e.g.
 * `2024-05-01T13:45:00.123Z`. The value must also be a real calendar instant in
 * canonical form (`new Date(v).toISOString() === v`), which rejects dates such
 * as Feb 30.
 */
export const Timestamp = z
  .string()
  .datetime({ precision: 3 })
  .refine((v) => {
    const ms = Date.parse(v);
    return Number.isFinite(ms) && new Date(ms).toISOString() === v;
  }, "Must be a valid UTC timestamp with millisecond precision");

/** Local calendar date `YYYY-MM-DD` that exists in the proleptic Gregorian calendar. */
export const LocalDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Must be YYYY-MM-DD")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number) as [number, number, number];
    if (m < 1 || m > 12 || d < 1) return false;
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return d <= daysInMonth;
  }, "Must be a real calendar date");

/** 24-hour local time `HH:MM`, 00:00–23:59 (12.4). */
export const HHMM_REGEX = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export const LocalTime = z.string().regex(HHMM_REGEX, "Must be HH:MM between 00:00 and 23:59");

export const Id = z.string().min(1);

const isTrimmed = (v: string) => v === v.trim();

/** A string stored in trimmed form whose length is within [min, max]. */
export const trimmedString = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine(isTrimmed, "Must not have leading or trailing whitespace");

/** Absolute URL whose scheme is one of `protocols`, at most 2,048 characters. */
export const isAbsoluteUrl = (v: string, protocols: readonly string[]): boolean => {
  if (v.length < 1 || v.length > 2048) return false;
  // No whitespace anywhere: `new URL` would silently strip/encode it.
  if (/\s/.test(v)) return false;
  try {
    const u = new URL(v);
    return protocols.includes(u.protocol) && u.hostname.length > 0;
  } catch {
    return false;
  }
};

export const HttpUrl = z
  .string()
  .max(2048)
  .refine((v) => isAbsoluteUrl(v, ["http:", "https:"]), "Must be an absolute http or https URL");

export const HttpsUrl = z
  .string()
  .max(2048)
  .refine((v) => isAbsoluteUrl(v, ["https:"]), "Must be an absolute https URL");

/** API key: 1–256 characters, no whitespace at all (already trimmed) (7.5). */
export const ApiKeySchema = z.string().regex(/^\S{1,256}$/, "Must be 1 to 256 characters with no whitespace");

export const BUCKET_NAME_REGEX = /^[a-z0-9-]{1,63}$/;
export const DEFAULT_BUCKET_NAME = "companion-backups";
export const BucketName = z.string().regex(BUCKET_NAME_REGEX, "Must be 1 to 63 lowercase letters, digits, or hyphens");

/** Backup namespace id: ≥ 128 bits of randomness, base64url (18.14). */
export const BackupNamespaceId = z.string().regex(/^[A-Za-z0-9_-]{22,64}$/);

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ToneSchema = z.enum(["cheerful", "calm", "playful"]);
export const ProviderModeSchema = z.enum(["auto", "ollama", "gemini"]);
export const ChatModeSchema = z.enum(["text", "voice"]);
export const RoleSchema = z.enum(["user", "companion"]);
export const MemoryCategorySchema = z.enum(["fact", "mood", "event", "person"]);
export const BackupLocationSchema = z.enum(["cloud", "file"]);
export const ActivityConsentSchema = z.enum(["opt_in", "opt_out", "dismissed"]);
export const ReminderStatusSchema = z.enum(["pending", "fired", "done", "cancelled"]);

// ---------------------------------------------------------------------------
// Ordering helpers
// ---------------------------------------------------------------------------

const ms = (t: string) => Date.parse(t);

/**
 * Adds an issue on `laterKey` when `later < earlier` (or `<=` if `strict`).
 * Only runs when both values are present; their own format errors are reported
 * by the field schemas.
 */
function checkOrder<T extends Record<string, unknown>>(
  ctx: z.RefinementCtx,
  rec: T,
  earlierKey: keyof T & string,
  laterKey: keyof T & string,
  strict = false,
) {
  const a = rec[earlierKey];
  const b = rec[laterKey];
  if (typeof a !== "string" || typeof b !== "string") return;
  const ok = strict ? ms(b) > ms(a) : ms(b) >= ms(a);
  if (!ok) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: [laterKey],
      message: `${laterKey} must be ${strict ? "later than" : "equal to or later than"} ${earlierKey}`,
    });
  }
}

const uniqueList = (v: readonly string[]) => new Set(v).size === v.length;

// ---------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------

/** 19.1 */
export const ProfileSchema = z
  .object({
    id: Id,
    displayName: trimmedString(1, 40),
    createdAt: Timestamp,
    lastUsedAt: Timestamp,
  })
  .strict()
  .superRefine((r, ctx) => checkOrder(ctx, r, "createdAt", "lastUsedAt"));

/** 19.2, minus `cloudStoreConfig` (moved to the browser record; see design). */
export const SettingsSchema = z
  .object({
    profileId: Id,
    botName: trimmedString(1, 30),
    tone: ToneSchema,
    providerMode: ProviderModeSchema,
    ollamaBaseUrl: z.union([z.literal(""), HttpUrl]),
    ollamaModel: z.union([z.literal(""), trimmedString(1, 100)]),
    geminiNoticeAcknowledgedAt: Timestamp.nullable(),
    activityTrackingEnabled: z.boolean(),
    notificationsEnabled: z.boolean(),
    checkInTimeOverride: LocalTime.nullable(),
    updatedAt: Timestamp,
  })
  .strict();

/** 19.3 */
export const ChatSchema = z
  .object({
    id: Id,
    profileId: Id,
    title: z.string().max(100),
    mode: ChatModeSchema,
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .strict()
  .superRefine((r, ctx) => checkOrder(ctx, r, "createdAt", "updatedAt"));

/** 19.4 */
export const MessageSchema = z
  .object({
    id: Id,
    chatId: Id,
    profileId: Id,
    role: RoleSchema,
    content: z.string().min(1).max(10_000),
    createdAt: Timestamp,
    safetyFlagged: z.boolean(),
    /** Where the Message came from; missing (older data) means "text". */
    channel: z.enum(["text", "voice"]).optional(),
    /** Groups the Messages of one voice call. */
    callId: Id.optional(),
  })
  .strict();

/** 19.5 */
export const MemorySchema = z
  .object({
    id: Id,
    profileId: Id,
    category: MemoryCategorySchema,
    content: trimmedString(1, 500),
    sourceChatIds: z.array(Id).min(1).max(100).refine(uniqueList, "Must not contain duplicates"),
    sourceMessageIds: z.array(Id).min(1).max(100).refine(uniqueList, "Must not contain duplicates"),
    createdAt: Timestamp,
    updatedAt: Timestamp,
  })
  .strict()
  .superRefine((r, ctx) => checkOrder(ctx, r, "createdAt", "updatedAt"));

/** 19.6 */
export const ActivityLogSchema = z
  .object({
    id: Id,
    profileId: Id,
    startedAt: Timestamp,
    endedAt: Timestamp,
    durationSeconds: z.number().int().min(0).max(86_400),
    page: z.string().min(1).max(200),
  })
  .strict()
  .superRefine((r, ctx) => {
    checkOrder(ctx, r, "startedAt", "endedAt");
    const start = ms(r.startedAt);
    const end = ms(r.endedAt);
    if (end >= start && r.durationSeconds !== Math.floor((end - start) / 1000)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["durationSeconds"],
        message: "durationSeconds must equal the whole seconds between startedAt and endedAt",
      });
    }
  });

/** 19.7 */
export const SummarySchema = z
  .object({
    profileId: Id,
    content: z.string().max(1_500),
    updatedAt: Timestamp,
  })
  .strict();

/** 19.8 */
export const BackupMetaSchema = z
  .object({
    id: Id,
    createdAt: Timestamp,
    schemaVersion: z.number().int().positive(),
    profileCount: z.number().int().min(0),
    sizeBytes: z.number().int().min(0),
    checksum: z.string().min(1),
    location: BackupLocationSchema,
  })
  .strict();

/** 19.9 plus `snoozeFiredAt` (null, or a timestamp ≥ `snoozedUntil`). */
export const CheckInSchema = z
  .object({
    profileId: Id,
    date: LocalDate,
    triggeredAt: Timestamp,
    snoozedUntil: Timestamp.nullable(),
    completedAt: Timestamp.nullable(),
    snoozeFiredAt: Timestamp.nullable(),
  })
  .strict()
  .superRefine((r, ctx) => {
    checkOrder(ctx, r, "triggeredAt", "snoozedUntil", true);
    checkOrder(ctx, r, "triggeredAt", "completedAt");
    if (r.snoozeFiredAt !== null && r.snoozedUntil === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["snoozeFiredAt"],
        message: "snoozeFiredAt requires snoozedUntil",
      });
    } else {
      checkOrder(ctx, r, "snoozedUntil", "snoozeFiredAt");
    }
  });

/** Per-profile bookkeeping (design addition). */
export const ProfileMetaSchema = z
  .object({
    profileId: Id,
    activityConsent: ActivityConsentSchema.nullable(),
    newMemoriesSinceSummary: z.number().int().min(0),
    summaryStale: z.boolean(),
    lastBreakSuggestionDate: LocalDate.nullable(),
    updatedAt: Timestamp,
  })
  .strict();

/** Max stored reminder text length (24.2, 24.3). */
export const REMINDER_TEXT_MAX = 200;

/** A companion reminder "call" (Req 24). Not included in backups. */
export const ReminderSchema = z
  .object({
    id: Id,
    profileId: Id,
    chatId: Id.nullable(),
    text: trimmedString(1, REMINDER_TEXT_MAX),
    dueAt: Timestamp,
    createdAt: Timestamp,
    status: ReminderStatusSchema,
    firedAt: Timestamp.nullable(),
  })
  .strict();

export const CloudStoreConfigSchema = z
  .object({
    supabaseUrl: HttpsUrl,
    supabaseAnonKey: ApiKeySchema,
    bucketName: BucketName.default(DEFAULT_BUCKET_NAME),
  })
  .strict();

/** 19.15 plus `cloudStoreConfig` and `epoch`. Never included in backups. */
export const BrowserRecordSchema = z
  .object({
    id: z.literal("singleton"),
    backupNamespaceId: BackupNamespaceId,
    createdAt: Timestamp,
    epoch: z.number().int().min(0),
    cloudStoreConfig: CloudStoreConfigSchema.nullable(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Tone = z.infer<typeof ToneSchema>;
export type ProviderMode = z.infer<typeof ProviderModeSchema>;
export type ChatMode = z.infer<typeof ChatModeSchema>;
export type Role = z.infer<typeof RoleSchema>;
export type MemoryCategory = z.infer<typeof MemoryCategorySchema>;
export type BackupLocation = z.infer<typeof BackupLocationSchema>;
export type ActivityConsent = z.infer<typeof ActivityConsentSchema>;

export type Profile = z.infer<typeof ProfileSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type Chat = z.infer<typeof ChatSchema>;
export type Message = z.infer<typeof MessageSchema>;
export type Memory = z.infer<typeof MemorySchema>;
export type ActivityLog = z.infer<typeof ActivityLogSchema>;
export type Summary = z.infer<typeof SummarySchema>;
export type BackupMeta = z.infer<typeof BackupMetaSchema>;
export type CheckIn = z.infer<typeof CheckInSchema>;
export type ProfileMeta = z.infer<typeof ProfileMetaSchema>;
export type ReminderStatus = z.infer<typeof ReminderStatusSchema>;
export type Reminder = z.infer<typeof ReminderSchema>;
export type CloudStoreConfig = z.infer<typeof CloudStoreConfigSchema>;
export type BrowserRecord = z.infer<typeof BrowserRecordSchema>;

/** Model name → schema, keyed by IndexedDB store name. */
export const MODEL_SCHEMAS = {
  profiles: ProfileSchema,
  settings: SettingsSchema,
  chats: ChatSchema,
  messages: MessageSchema,
  memories: MemorySchema,
  activityLogs: ActivityLogSchema,
  summaries: SummarySchema,
  backupMeta: BackupMetaSchema,
  checkIns: CheckInSchema,
  profileMeta: ProfileMetaSchema,
  reminders: ReminderSchema,
  browser: BrowserRecordSchema,
} as const;

export type StoreName = keyof typeof MODEL_SCHEMAS;

/** Converts epoch milliseconds to a model `Timestamp` string. */
export const toTimestamp = (epochMs: number): string => new Date(epochMs).toISOString();

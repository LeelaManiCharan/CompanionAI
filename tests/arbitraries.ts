/**
 * Shared fast-check generators. Everything generated here is valid against the
 * zod models in `src/core/models.ts` unless a generator's name says otherwise.
 */
import fc from "fast-check";
import {
  DEFAULT_BUCKET_NAME,
  toTimestamp,
  type ActivityConsent,
  type ActivityLog,
  type BackupMeta,
  type BrowserRecord,
  type Chat,
  type ChatMode,
  type CheckIn,
  type Memory,
  type MemoryCategory,
  type Message,
  type Profile,
  type ProfileMeta,
  type ProviderMode,
  type Role,
  type Settings,
  type Summary,
  type Tone,
} from "@/core/models";
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from "@/core/validators";

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/** Fixed IANA zones, including 30-minute DST (Lord_Howe) and +12:45/+13:45 (Chatham). */
export const TIME_ZONES = [
  "UTC",
  "America/New_York",
  "America/Los_Angeles",
  "America/St_Johns",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Kolkata",
  "Asia/Kathmandu",
  "Australia/Lord_Howe",
  "Pacific/Chatham",
  "Pacific/Kiritimati",
] as const;
export type TimeZone = (typeof TIME_ZONES)[number];
export const arbTimeZone: fc.Arbitrary<TimeZone> = fc.constantFrom(...TIME_ZONES);

export const MIN_TIMESTAMP_MS = Date.UTC(2000, 0, 1);
export const MAX_TIMESTAMP_MS = Date.UTC(2099, 11, 31, 23, 59, 59, 999);

const DAY_MS = 86_400_000;

/** Epoch milliseconds (UTC, millisecond precision). */
export const arbTimestampMs = (min = MIN_TIMESTAMP_MS, max = MAX_TIMESTAMP_MS) => fc.integer({ min, max });

/** Model `Timestamp` string, e.g. `2031-04-05T06:07:08.009Z`. */
export const arbTimestamp = (min = MIN_TIMESTAMP_MS, max = MAX_TIMESTAMP_MS) =>
  arbTimestampMs(min, max).map(toTimestamp);

/** Local calendar date `YYYY-MM-DD`. */
export const arbLocalDate = arbTimestampMs().map((ms) => toTimestamp(ms).slice(0, 10));

/** `HH:MM`, 00:00–23:59. */
export const arbHHMM = fc
  .tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 59 }))
  .map(([h, m]) => `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);

// ---------------------------------------------------------------------------
// Strings
// ---------------------------------------------------------------------------

const fromCode = (min: number, max: number) => fc.integer({ min, max }).map((c) => String.fromCodePoint(c));

export const WHITESPACE_CHARS = [" ", "\t", "\n", "\u00a0", "\u2003", "\u3000"] as const;

/**
 * A single code point: mostly printable ASCII, plus BMP letters/CJK, astral
 * characters (emoji, supplementary CJK — 2 UTF-16 units each), and whitespace.
 * Lone surrogates are never produced.
 */
export const arbChar: fc.Arbitrary<string> = fc.oneof(
  { arbitrary: fromCode(0x21, 0x7e), weight: 6 },
  { arbitrary: fc.constant(" "), weight: 1 },
  { arbitrary: fromCode(0x00c0, 0x024f), weight: 1 },
  { arbitrary: fromCode(0x4e00, 0x9fff), weight: 1 },
  { arbitrary: fromCode(0x1f300, 0x1faff), weight: 1 },
  { arbitrary: fromCode(0x20000, 0x2a6df), weight: 1 },
  { arbitrary: fc.constantFrom(...WHITESPACE_CHARS), weight: 1 },
);

/** Non-whitespace printable ASCII character. */
export const arbTokenChar = fromCode(0x21, 0x7e);

/** Unicode string of `minLength`–`maxLength` code points (UTF-16 length can be up to 2×). */
export const arbUnicodeString = ({ minLength = 0, maxLength = 50 }: { minLength?: number; maxLength?: number } = {}) =>
  fc.string({ unit: arbChar, minLength, maxLength });

/** Cuts `s` to at most `max` UTF-16 units without splitting a surrogate pair. */
export function truncateUtf16(s: string, max: number): string {
  let out = "";
  for (const cp of s) {
    if (out.length + cp.length > max) break;
    out += cp;
  }
  return out;
}

/**
 * Unicode text whose UTF-16 length is within [min, max]. With `trimmed`, the
 * value has no leading/trailing whitespace (as stored by trimmed fields).
 */
export const arbText = (min: number, max: number, { trimmed = false }: { trimmed?: boolean } = {}) =>
  fc
    .string({ unit: arbChar, minLength: min, maxLength: max })
    .map((s) => {
      const cut = truncateUtf16(s, max);
      return trimmed ? cut.trim() : cut;
    })
    .filter((s) => s.length >= min && s.length <= max);

// ---------------------------------------------------------------------------
// Enums and small values
// ---------------------------------------------------------------------------

export const arbTone: fc.Arbitrary<Tone> = fc.constantFrom("cheerful", "calm", "playful");
export const arbProviderMode: fc.Arbitrary<ProviderMode> = fc.constantFrom("auto", "ollama", "gemini");
export const arbChatMode: fc.Arbitrary<ChatMode> = fc.constantFrom("text", "voice");
export const arbRole: fc.Arbitrary<Role> = fc.constantFrom("user", "companion");
export const arbMemoryCategory: fc.Arbitrary<MemoryCategory> = fc.constantFrom("fact", "mood", "event", "person");
export const arbActivityConsent: fc.Arbitrary<ActivityConsent> = fc.constantFrom("opt_in", "opt_out", "dismissed");

export const arbOllamaBaseUrl = fc.constantFrom(
  DEFAULT_OLLAMA_BASE_URL,
  "http://127.0.0.1:11434",
  "https://ollama.example.com:8443/",
  "http://my-box.local:11434/base",
);
export const arbHttpsUrl = fc.constantFrom(
  "https://abcdefghijklmnop.supabase.co",
  "https://example.supabase.co/",
  "https://storage.example.org:8443/path",
);
export const arbApiKey = fc.string({ unit: arbTokenChar, minLength: 1, maxLength: 256 });
export const arbBucketName = fc.oneof(
  fc.constant(DEFAULT_BUCKET_NAME),
  fc.string({ unit: fc.constantFrom(..."abcdefghijklmnopqrstuvwxyz0123456789-"), minLength: 1, maxLength: 63 }),
);

const BASE64URL = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
export const arbBackupNamespaceId = fc.string({ unit: fc.constantFrom(...BASE64URL), minLength: 22, maxLength: 64 });

const gap = (maxMs: number) => fc.integer({ min: 0, max: maxMs });

// ---------------------------------------------------------------------------
// Standalone records
// ---------------------------------------------------------------------------

export const arbBrowserRecord: fc.Arbitrary<BrowserRecord> = fc.record({
  id: fc.constant("singleton" as const),
  backupNamespaceId: arbBackupNamespaceId,
  createdAt: arbTimestamp(),
  epoch: fc.nat({ max: 1_000 }),
  cloudStoreConfig: fc.option(
    fc.record({ supabaseUrl: arbHttpsUrl, supabaseAnonKey: arbApiKey, bucketName: arbBucketName }),
    { nil: null },
  ),
});

export const arbBackupMeta: fc.Arbitrary<BackupMeta> = fc.record({
  id: fc.uuid(),
  createdAt: arbTimestamp(),
  schemaVersion: fc.integer({ min: 1, max: 10 }),
  profileCount: fc.nat({ max: 3 }),
  sizeBytes: fc.nat({ max: 50 * 1024 * 1024 }),
  checksum: fc.string({ unit: fc.constantFrom(..."0123456789abcdef"), minLength: 64, maxLength: 64 }),
  location: fc.constantFrom("cloud" as const, "file" as const),
});

/** A valid Daily_Check_In for `profileId`. */
export const arbCheckIn = (profileId: string): fc.Arbitrary<CheckIn> =>
  fc
    .record({
      triggeredMs: arbTimestampMs(MIN_TIMESTAMP_MS, MAX_TIMESTAMP_MS - 2 * DAY_MS),
      snoozeGap: fc.option(fc.integer({ min: 1, max: 30 * 60_000 }), { nil: null }),
      completedGap: fc.option(gap(DAY_MS), { nil: null }),
      firedGap: fc.option(gap(60_000), { nil: null }),
    })
    .map(({ triggeredMs, snoozeGap, completedGap, firedGap }) => {
      const snoozedMs = snoozeGap === null ? null : triggeredMs + snoozeGap;
      return {
        profileId,
        date: toTimestamp(triggeredMs).slice(0, 10),
        triggeredAt: toTimestamp(triggeredMs),
        snoozedUntil: snoozedMs === null ? null : toTimestamp(snoozedMs),
        completedAt: completedGap === null ? null : toTimestamp(triggeredMs + completedGap),
        snoozeFiredAt: snoozedMs === null || firedGap === null ? null : toTimestamp(snoozedMs + firedGap),
      };
    });

// ---------------------------------------------------------------------------
// Consistent datasets
// ---------------------------------------------------------------------------

export interface Dataset {
  profiles: Profile[];
  settings: Settings[];
  chats: Chat[];
  messages: Message[];
  memories: Memory[];
  activityLogs: ActivityLog[];
  summaries: Summary[];
  profileMeta: ProfileMeta[];
}

export interface DatasetOptions {
  minProfiles?: number;
  maxProfiles?: number;
  /** Total chats across all profiles. */
  maxChats?: number;
  maxMessagesPerChat?: number;
  maxMemoriesPerProfile?: number;
  maxActivityLogsPerProfile?: number;
}

// All offsets stay well inside this window so derived timestamps never pass MAX_TIMESTAMP_MS.
const PROFILE_BASE_MAX_MS = Date.UTC(2090, 0, 1);

const arbMessageSeed = fc.record({
  tag: fc.uuid(),
  role: arbRole,
  content: arbText(1, 10_000),
  gapMs: gap(3_600_000),
  safetyFlagged: fc.boolean(),
});

const arbChatSeed = (maxMessages: number) =>
  fc.record({
    tag: fc.uuid(),
    title: arbText(0, 100),
    mode: arbChatMode,
    offsetMs: gap(30 * DAY_MS),
    updateGapMs: gap(DAY_MS),
    messages: fc.array(arbMessageSeed, { maxLength: maxMessages }),
  });

const arbMemorySeed = fc.record({
  tag: fc.uuid(),
  category: arbMemoryCategory,
  content: arbText(1, 500, { trimmed: true }),
  chatPicks: fc.array(fc.nat(), { minLength: 1, maxLength: 5 }),
  messagePicks: fc.array(fc.nat(), { minLength: 1, maxLength: 5 }),
  offsetMs: gap(60 * DAY_MS),
  updateGapMs: gap(DAY_MS),
});

const arbActivitySeed = fc.record({
  tag: fc.uuid(),
  offsetMs: gap(60 * DAY_MS),
  durationSeconds: fc.integer({ min: 0, max: 86_400 }),
  remainderMs: fc.integer({ min: 0, max: 999 }),
  page: fc.oneof(fc.constantFrom("/", "/chat", "/call", "/settings", "/memories"), arbText(1, 200)),
});

const arbSettingsSeed = fc.record({
  botName: arbText(1, 30, { trimmed: true }),
  tone: arbTone,
  providerMode: arbProviderMode,
  ollamaBaseUrl: fc.oneof(fc.constant(""), arbOllamaBaseUrl),
  ollamaModel: fc.oneof(fc.constant(""), fc.constant(DEFAULT_OLLAMA_MODEL), arbText(1, 100, { trimmed: true })),
  ackGapMs: fc.option(gap(DAY_MS), { nil: null }),
  activityTrackingEnabled: fc.boolean(),
  notificationsEnabled: fc.boolean(),
  checkInTimeOverride: fc.option(arbHHMM, { nil: null }),
  updateGapMs: gap(DAY_MS),
});

const arbProfileSeed = (o: Required<DatasetOptions>, maxChats: number) =>
  fc.record({
    tag: fc.uuid(),
    displayName: arbText(1, 40, { trimmed: true }),
    createdMs: arbTimestampMs(MIN_TIMESTAMP_MS, PROFILE_BASE_MAX_MS),
    lastUsedGapMs: gap(90 * DAY_MS),
    settings: arbSettingsSeed,
    chats: fc.array(arbChatSeed(o.maxMessagesPerChat), { maxLength: maxChats }),
    memories: fc.array(arbMemorySeed, { maxLength: o.maxMemoriesPerProfile }),
    activity: fc.array(arbActivitySeed, { maxLength: o.maxActivityLogsPerProfile }),
    summary: arbText(0, 1_500),
    summaryGapMs: gap(DAY_MS),
    meta: fc.record({
      activityConsent: fc.option(arbActivityConsent, { nil: null }),
      newMemoriesSinceSummary: fc.nat({ max: 50 }),
      summaryStale: fc.boolean(),
      breakGapMs: fc.option(gap(60 * DAY_MS), { nil: null }),
      updateGapMs: gap(DAY_MS),
    }),
  });

type ProfileSeed = ReturnType<typeof arbProfileSeed> extends fc.Arbitrary<infer S> ? S : never;

const unique = <T>(xs: T[]) => [...new Set(xs)];

function assemble(seeds: ProfileSeed[]): Dataset {
  const ds: Dataset = {
    profiles: [],
    settings: [],
    chats: [],
    messages: [],
    memories: [],
    activityLogs: [],
    summaries: [],
    profileMeta: [],
  };
  // A running counter keeps ids unique even if fast-check shrinks uuids to equal values.
  let n = 0;
  const id = (tag: string) => `${tag}-${n++}`;
  const ts = toTimestamp;

  for (const p of seeds) {
    const profileId = id(p.tag);
    const created = p.createdMs;
    ds.profiles.push({
      id: profileId,
      displayName: p.displayName,
      createdAt: ts(created),
      lastUsedAt: ts(created + p.lastUsedGapMs),
    });

    const s = p.settings;
    ds.settings.push({
      profileId,
      botName: s.botName,
      tone: s.tone,
      providerMode: s.providerMode,
      ollamaBaseUrl: s.ollamaBaseUrl,
      ollamaModel: s.ollamaModel,
      geminiNoticeAcknowledgedAt: s.ackGapMs === null ? null : ts(created + s.ackGapMs),
      activityTrackingEnabled: s.activityTrackingEnabled,
      notificationsEnabled: s.notificationsEnabled,
      checkInTimeOverride: s.checkInTimeOverride,
      updatedAt: ts(created + s.updateGapMs),
    });

    // Chats and their messages (messages are created in order after the chat).
    const chatsWithMessages: { chatId: string; messageIds: string[] }[] = [];
    for (const c of p.chats) {
      const chatId = id(c.tag);
      const chatCreated = created + c.offsetMs;
      let t = chatCreated;
      const messageIds: string[] = [];
      for (const m of c.messages) {
        t += m.gapMs;
        const messageId = id(m.tag);
        messageIds.push(messageId);
        ds.messages.push({
          id: messageId,
          chatId,
          profileId,
          role: m.role,
          content: m.content,
          createdAt: ts(t),
          safetyFlagged: m.safetyFlagged,
        });
      }
      ds.chats.push({
        id: chatId,
        profileId,
        title: c.title,
        mode: c.mode,
        createdAt: ts(chatCreated),
        updatedAt: ts(Math.max(t, chatCreated + c.updateGapMs)),
      });
      if (messageIds.length > 0) chatsWithMessages.push({ chatId, messageIds });
    }

    // Memories reference 1+ chats of this profile and 1+ messages from those chats.
    if (chatsWithMessages.length > 0) {
      for (const m of p.memories) {
        const picked = unique(m.chatPicks.map((i) => chatsWithMessages[i % chatsWithMessages.length]!));
        const pool = picked.flatMap((c) => c.messageIds);
        const memCreated = created + m.offsetMs;
        ds.memories.push({
          id: id(m.tag),
          profileId,
          category: m.category,
          content: m.content,
          sourceChatIds: picked.map((c) => c.chatId),
          sourceMessageIds: unique(m.messagePicks.map((i) => pool[i % pool.length]!)),
          createdAt: ts(memCreated),
          updatedAt: ts(memCreated + m.updateGapMs),
        });
      }
    }

    for (const a of p.activity) {
      const start = created + a.offsetMs;
      ds.activityLogs.push({
        id: id(a.tag),
        profileId,
        startedAt: ts(start),
        endedAt: ts(start + a.durationSeconds * 1000 + a.remainderMs),
        durationSeconds: a.durationSeconds,
        page: a.page,
      });
    }

    ds.summaries.push({ profileId, content: p.summary, updatedAt: ts(created + p.summaryGapMs) });

    ds.profileMeta.push({
      profileId,
      activityConsent: p.meta.activityConsent,
      newMemoriesSinceSummary: p.meta.newMemoriesSinceSummary,
      summaryStale: p.meta.summaryStale,
      lastBreakSuggestionDate: p.meta.breakGapMs === null ? null : ts(created + p.meta.breakGapMs).slice(0, 10),
      updatedAt: ts(created + p.meta.updateGapMs),
    });
  }
  return ds;
}

/**
 * A dataset with consistent foreign keys: 1–3 profiles, each with one Settings,
 * Summary, and ProfileMeta; up to `maxChats` chats in total; messages whose
 * `profileId` matches their chat; memories whose sources are chats and
 * messages of the same profile.
 */
export const arbDataset = (options: DatasetOptions = {}): fc.Arbitrary<Dataset> => {
  const o: Required<DatasetOptions> = {
    minProfiles: 1,
    maxProfiles: 3,
    maxChats: 20,
    maxMessagesPerChat: 30,
    maxMemoriesPerProfile: 10,
    maxActivityLogsPerProfile: 10,
    ...options,
  };
  return fc.integer({ min: o.minProfiles, max: o.maxProfiles }).chain((count) =>
    fc
      .array(arbProfileSeed(o, Math.floor(o.maxChats / count)), { minLength: count, maxLength: count })
      .map(assemble),
  );
};

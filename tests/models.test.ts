import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  ActivityLogSchema,
  BrowserRecordSchema,
  ChatSchema,
  CheckInSchema,
  MemorySchema,
  MessageSchema,
  ProfileSchema,
  SCHEMA_VERSION,
  SettingsSchema,
  Timestamp,
  BackupMetaSchema,
  ProfileMetaSchema,
  SummarySchema,
  LocalDate,
} from "@/core/models";
import {
  DEFAULT_BOT_NAME,
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  DEFAULT_PROVIDER_MODE,
  DEFAULT_TONE,
  defaultSettings,
  validateApiKey,
  validateBotName,
  validateBucketName,
  validateCheckInTime,
  validateDisplayName,
  validateMemoryContent,
  validateMessageText,
  validateOllamaBaseUrl,
  validateOllamaModel,
  validatePassphrase,
  validateSummary,
  validateSupabaseUrl,
} from "@/core/validators";
import { arbBackupMeta, arbBrowserRecord, arbCheckIn, arbDataset, truncateUtf16 } from "./arbitraries";

const T0 = "2024-05-01T10:00:00.000Z";
const T1 = "2024-05-01T10:00:01.000Z";

describe("models", () => {
  it("uses schema version 1", () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it("accepts only UTC millisecond timestamps", () => {
    expect(Timestamp.safeParse(T0).success).toBe(true);
    expect(Timestamp.safeParse("2024-05-01T10:00:00Z").success).toBe(false);
    expect(Timestamp.safeParse("2024-05-01T10:00:00.000+02:00").success).toBe(false);
    expect(Timestamp.safeParse("2024-02-30T10:00:00.000Z").success).toBe(false);
  });

  it("validates local dates", () => {
    expect(LocalDate.safeParse("2024-02-29").success).toBe(true);
    expect(LocalDate.safeParse("2023-02-29").success).toBe(false);
    expect(LocalDate.safeParse("2024-13-01").success).toBe(false);
  });

  it("rejects ordering violations and names the field", () => {
    const r = ProfileSchema.safeParse({ id: "p", displayName: "Ana", createdAt: T1, lastUsedAt: T0 });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["lastUsedAt"]);

    const chat = ChatSchema.safeParse({ id: "c", profileId: "p", title: "", mode: "text", createdAt: T1, updatedAt: T0 });
    expect(chat.error?.issues[0]?.path).toEqual(["updatedAt"]);
  });

  it("checks activity duration and check-in ordering", () => {
    const log = { id: "a", profileId: "p", startedAt: T0, endedAt: "2024-05-01T10:00:01.999Z", page: "/" };
    expect(ActivityLogSchema.safeParse({ ...log, durationSeconds: 1 }).success).toBe(true);
    expect(ActivityLogSchema.safeParse({ ...log, durationSeconds: 2 }).success).toBe(false);

    const ci = { profileId: "p", date: "2024-05-01", triggeredAt: T0, completedAt: null, snoozeFiredAt: null };
    expect(CheckInSchema.safeParse({ ...ci, snoozedUntil: T0 }).success).toBe(false); // must be strictly later
    expect(CheckInSchema.safeParse({ ...ci, snoozedUntil: T1 }).success).toBe(true);
    expect(CheckInSchema.safeParse({ ...ci, snoozedUntil: null, snoozeFiredAt: T1 }).success).toBe(false);
  });

  it("rejects untrimmed names, unknown fields, and cloudStoreConfig in Settings", () => {
    expect(ProfileSchema.safeParse({ id: "p", displayName: " Ana", createdAt: T0, lastUsedAt: T0 }).success).toBe(false);
    const s = defaultSettings("p", T0);
    expect(SettingsSchema.safeParse(s).success).toBe(true);
    expect(SettingsSchema.safeParse({ ...s, cloudStoreConfig: null }).success).toBe(false);
  });

  it("validates the browser record cloud store config", () => {
    const base = { id: "singleton", backupNamespaceId: "A".repeat(22), createdAt: T0, epoch: 0 };
    expect(BrowserRecordSchema.safeParse({ ...base, cloudStoreConfig: null }).success).toBe(true);
    const parsed = BrowserRecordSchema.parse({
      ...base,
      cloudStoreConfig: { supabaseUrl: "https://x.supabase.co", supabaseAnonKey: "key" },
    });
    expect(parsed.cloudStoreConfig?.bucketName).toBe("companion-backups");
    expect(
      BrowserRecordSchema.safeParse({
        ...base,
        cloudStoreConfig: { supabaseUrl: "http://x.supabase.co", supabaseAnonKey: "key", bucketName: "b" },
      }).success,
    ).toBe(false);
  });

  it("generators in tests/arbitraries.ts produce schema-valid records", () => {
    for (const ds of fc.sample(arbDataset({ maxMessagesPerChat: 5 }), 30)) {
      expect(ds.profiles.length).toBeGreaterThanOrEqual(1);
      expect(ds.profiles.length).toBeLessThanOrEqual(3);
      expect(ds.chats.length).toBeLessThanOrEqual(20);
      ds.profiles.forEach((r) => expect(ProfileSchema.parse(r)).toEqual(r));
      ds.settings.forEach((r) => expect(SettingsSchema.parse(r)).toEqual(r));
      ds.chats.forEach((r) => expect(ChatSchema.parse(r)).toEqual(r));
      ds.messages.forEach((r) => expect(MessageSchema.parse(r)).toEqual(r));
      ds.memories.forEach((r) => expect(MemorySchema.parse(r)).toEqual(r));
      ds.activityLogs.forEach((r) => expect(ActivityLogSchema.parse(r)).toEqual(r));
      ds.summaries.forEach((r) => expect(SummarySchema.parse(r)).toEqual(r));
      ds.profileMeta.forEach((r) => expect(ProfileMetaSchema.parse(r)).toEqual(r));

      const chatProfile = new Map(ds.chats.map((c) => [c.id, c.profileId]));
      ds.messages.forEach((m) => expect(chatProfile.get(m.chatId)).toBe(m.profileId));
      ds.memories.forEach((m) => m.sourceChatIds.forEach((c) => expect(chatProfile.get(c)).toBe(m.profileId)));
    }
    fc.sample(arbBrowserRecord, 30).forEach((r) => expect(BrowserRecordSchema.safeParse(r).success).toBe(true));
    fc.sample(arbBackupMeta, 30).forEach((r) => expect(BackupMetaSchema.safeParse(r).success).toBe(true));
    fc.sample(arbCheckIn("p"), 30).forEach((r) => expect(CheckInSchema.safeParse(r).success).toBe(true));
  });

  it("truncateUtf16 never splits surrogate pairs", () => {
    expect(truncateUtf16("a😀b", 2)).toBe("a");
    expect(truncateUtf16("a😀b", 3)).toBe("a😀");
  });
});

describe("validators", () => {
  it("exposes defaults", () => {
    expect([DEFAULT_BOT_NAME, DEFAULT_TONE, DEFAULT_PROVIDER_MODE]).toEqual(["Sunny", "calm", "auto"]);
    expect([DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL]).toEqual(["http://localhost:11434", "llama3.1:8b"]);
  });

  it("trims and bounds names", () => {
    expect(validateDisplayName("  Ana  ")).toEqual({ ok: true, value: "Ana" });
    expect(validateDisplayName("   ").ok).toBe(false);
    expect(validateDisplayName("x".repeat(40)).ok).toBe(true);
    expect(validateDisplayName("x".repeat(41)).ok).toBe(false);
    expect(validateBotName(" " + "b".repeat(30) + " ").ok).toBe(true);
    expect(validateBotName("b".repeat(31)).ok).toBe(false);
  });

  it("validates message text without trimming it", () => {
    expect(validateMessageText(" hi ")).toEqual({ ok: true, value: " hi " });
    expect(validateMessageText(" \n\t").ok).toBe(false);
    expect(validateMessageText("").ok).toBe(false);
    expect(validateMessageText("x".repeat(4_000)).ok).toBe(true);
    expect(validateMessageText("x".repeat(4_001)).ok).toBe(false);
  });

  it("validates Ollama settings", () => {
    expect(validateOllamaBaseUrl(" http://localhost:11434 ")).toEqual({ ok: true, value: "http://localhost:11434" });
    expect(validateOllamaBaseUrl("ftp://localhost").ok).toBe(false);
    expect(validateOllamaBaseUrl("localhost:11434").ok).toBe(false);
    expect(validateOllamaBaseUrl("http://" + "a".repeat(2_048)).ok).toBe(false);
    expect(validateOllamaModel(" llama3.1:8b ")).toEqual({ ok: true, value: "llama3.1:8b" });
    expect(validateOllamaModel("m".repeat(101)).ok).toBe(false);
  });

  it("validates API keys", () => {
    expect(validateApiKey("  abc.def  ")).toEqual({ ok: true, value: "abc.def" });
    expect(validateApiKey("abc def").ok).toBe(false);
    expect(validateApiKey("k".repeat(256)).ok).toBe(true);
    expect(validateApiKey("k".repeat(257)).ok).toBe(false);
    expect(validateApiKey("  ").ok).toBe(false);
  });

  it("validates HH:MM overrides", () => {
    expect(validateCheckInTime("00:00").ok).toBe(true);
    expect(validateCheckInTime(" 23:59 ")).toEqual({ ok: true, value: "23:59" });
    for (const bad of ["24:00", "7:30", "12:60", "12-30", ""]) expect(validateCheckInTime(bad).ok).toBe(false);
  });

  it("validates backup inputs", () => {
    expect(validatePassphrase("1234567").ok).toBe(false);
    expect(validatePassphrase("12345678").ok).toBe(true);
    expect(validatePassphrase("p".repeat(129)).ok).toBe(false);
    expect(validateSupabaseUrl("https://x.supabase.co").ok).toBe(true);
    expect(validateSupabaseUrl("http://x.supabase.co").ok).toBe(false);
    expect(validateBucketName("companion-backups").ok).toBe(true);
    expect(validateBucketName("Companion").ok).toBe(false);
    expect(validateBucketName("b".repeat(64)).ok).toBe(false);
  });

  it("validates memory and summary content", () => {
    expect(validateMemoryContent(" likes tea ")).toEqual({ ok: true, value: "likes tea" });
    expect(validateMemoryContent(" ").ok).toBe(false);
    expect(validateMemoryContent("m".repeat(501)).ok).toBe(false);
    expect(validateSummary("").ok).toBe(true);
    expect(validateSummary("s".repeat(1_500)).ok).toBe(true);
    expect(validateSummary("s".repeat(1_501)).ok).toBe(false);
  });
});

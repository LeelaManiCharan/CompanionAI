import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { canonicalJson, MAX_BACKUP_BYTES, parseBackup, serializeBackup, type BackupData } from "@/core/backup";
import { SCHEMA_VERSION } from "@/core/models";
import { arbDataset, type Dataset } from "./arbitraries";

const EXPORTED_AT = "2030-01-02T03:04:05.006Z";
const byteLen = (s: string) => new TextEncoder().encode(s).length;

/** One deterministic sample with every collection populated. */
const sample = (): Dataset =>
  fc.sample(
    arbDataset({ minProfiles: 2, maxChats: 6, maxMessagesPerChat: 4 }).filter(
      (d) => d.messages.length > 0 && d.memories.length > 0,
    ),
    { numRuns: 1, seed: 42 },
  )[0]!;

const byKey = <T>(xs: T[], k: keyof T) => [...xs].sort((a, b) => (String(a[k]) < String(b[k]) ? -1 : 1));
const sorted = (d: BackupData): BackupData => ({
  profiles: byKey(d.profiles, "id"),
  settings: byKey(d.settings, "profileId"),
  chats: byKey(d.chats, "id"),
  messages: byKey(d.messages, "id"),
  memories: byKey(d.memories, "id"),
  activityLogs: byKey(d.activityLogs, "id"),
  summaries: byKey(d.summaries, "profileId"),
  profileMeta: byKey(d.profileMeta, "profileId"),
});

/** Re-signs a modified document so only the targeted check can fail. */
async function resign(doc: Record<string, unknown>): Promise<string> {
  const { checksum: _drop, ...payload } = doc;
  void _drop;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalJson(payload)));
  const checksum = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  return canonicalJson({ ...payload, checksum });
}

describe("serializeBackup / parseBackup", () => {
  it("round-trips a dataset with canonical, byte-identical output", async () => {
    const d = sample();
    const text = await serializeBackup(d, EXPORTED_AT);
    const doc = JSON.parse(text) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(["checksum", "data", "exportedAt", "schemaVersion"]);
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(text).toContain('\n  "data": {');

    const parsed = await parseBackup(text, byteLen(text));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual(sorted(d));
    expect(await serializeBackup(parsed.value, EXPORTED_AT)).toBe(text);

    const reversed = Object.fromEntries(
      Object.entries(d).map(([k, v]) => [k, [...(v as unknown[])].reverse()]),
    ) as unknown as BackupData;
    expect(await serializeBackup(reversed, EXPORTED_AT)).toBe(text);
  });

  it("drops unknown fields and never includes browser-level config", async () => {
    const d = sample();
    const leaky = {
      ...d,
      settings: d.settings.map((s) => ({ ...s, cloudStoreConfig: { supabaseAnonKey: "SECRET-ANON-KEY" } })),
      browser: [{ id: "singleton" }],
    } as unknown as BackupData;
    const text = await serializeBackup(leaky, EXPORTED_AT);
    expect(text).not.toContain("SECRET-ANON-KEY");
    expect(text).not.toContain("cloudStoreConfig");
    expect(text).not.toContain('"browser"');
  });

  it("rejects oversize input before parsing", async () => {
    expect(await parseBackup("not json", MAX_BACKUP_BYTES + 1)).toEqual({ ok: false, error: { kind: "too_large" } });
  });

  it("classifies invalid JSON and unsupported schema versions", async () => {
    const text = await serializeBackup(sample(), EXPORTED_AT);
    const truncated = text.slice(0, text.length - 5);
    expect(await parseBackup(truncated, byteLen(truncated))).toEqual({ ok: false, error: { kind: "invalid_json" } });

    for (const v of [undefined, 1.5, "1", SCHEMA_VERSION + 1]) {
      const doc = JSON.parse(text) as Record<string, unknown>;
      doc.schemaVersion = v;
      const t = await resign(doc);
      expect(await parseBackup(t, byteLen(t))).toEqual({ ok: false, error: { kind: "unsupported_schema" } });
    }
  });

  it("detects a checksum mismatch", async () => {
    const d = sample();
    const text = await serializeBackup(d, EXPORTED_AT);
    const doc = JSON.parse(text) as { data: BackupData };
    doc.data.profiles[0]!.displayName = "Tampered";
    const t = canonicalJson(doc);
    expect(await parseBackup(t, byteLen(t))).toEqual({ ok: false, error: { kind: "checksum_mismatch" } });
  });

  it("names the first missing required field", async () => {
    const doc = JSON.parse(await serializeBackup(sample(), EXPORTED_AT)) as { data: Record<string, unknown[]> };
    delete (doc.data.chats[0] as Record<string, unknown>).title;
    const t = await resign(doc as unknown as Record<string, unknown>);
    expect(await parseBackup(t, byteLen(t))).toEqual({
      ok: false,
      error: { kind: "missing_field", field: "data.chats[0].title" },
    });
  });

  it("reports a missing parent with record type and reference", async () => {
    const doc = JSON.parse(await serializeBackup(sample(), EXPORTED_AT)) as { data: BackupData };
    doc.data.messages[0]!.chatId = "no-such-chat";
    const t = await resign(doc as unknown as Record<string, unknown>);
    expect(await parseBackup(t, byteLen(t))).toEqual({
      ok: false,
      error: { kind: "missing_parent", recordType: "Message", ref: "no-such-chat" },
    });
  });

  it("rejects more than 3 profiles", async () => {
    const d = sample();
    const base = d.profiles[0]!;
    const extra = ["x1", "x2", "x3"].map((id) => ({ ...base, id }));
    const text = await serializeBackup({ ...d, profiles: [...d.profiles, ...extra] }, EXPORTED_AT);
    expect(await parseBackup(text, byteLen(text))).toEqual({ ok: false, error: { kind: "too_many_profiles" } });
  });

  it("accepts a dataset with zero profiles", async () => {
    const empty: BackupData = {
      profiles: [],
      settings: [],
      chats: [],
      messages: [],
      memories: [],
      activityLogs: [],
      summaries: [],
      profileMeta: [],
    };
    const text = await serializeBackup(empty, EXPORTED_AT);
    expect(await parseBackup(text, byteLen(text))).toEqual({ ok: true, value: empty });
  });
});

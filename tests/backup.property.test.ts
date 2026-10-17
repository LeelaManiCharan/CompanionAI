/**
 * Feature: ai-companion-checkin, Property 15: Backup round-trip and determinism
 * Validates: Requirements 17.1, 17.3, 17.7, 17.8
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { parseBackup, serializeBackup, type BackupData } from "@/core/backup";
import { arbDataset, arbTimestamp, type Dataset } from "./arbitraries";

const byteLen = (s: string) => new TextEncoder().encode(s).length;

const EMPTY: Dataset = {
  profiles: [],
  settings: [],
  chats: [],
  messages: [],
  memories: [],
  activityLogs: [],
  summaries: [],
  profileMeta: [],
};

/** Valid datasets: zero profiles, or 1–3 small profiles (empty collections occur naturally). */
const arbBackupData: fc.Arbitrary<BackupData> = fc.oneof(
  { arbitrary: fc.constant(EMPTY), weight: 1 },
  {
    arbitrary: arbDataset({
      maxChats: 4,
      maxMessagesPerChat: 3,
      maxMemoriesPerProfile: 3,
      maxActivityLogsPerProfile: 3,
    }),
    weight: 6,
  },
);

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

/** Small deterministic PRNG (mulberry32) so a single generated seed drives all permutations. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: readonly T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Rebuilds a record with its own keys inserted in a shuffled order (values unchanged). */
const shuffleKeys = (rec: object, rand: () => number): object => {
  const r = rec as Record<string, unknown>;
  return Object.fromEntries(shuffle(Object.keys(r), rand).map((k) => [k, r[k]]));
};

/** Permutes every collection's record order, every record's key order, and the section key order. */
function permute(d: BackupData, seed: number): BackupData {
  const rand = rng(seed);
  const sections = shuffle(Object.keys(d) as (keyof BackupData)[], rand);
  return Object.fromEntries(
    sections.map((name) => [name, shuffle(d[name] as object[], rand).map((rec) => shuffleKeys(rec, rand))]),
  ) as unknown as BackupData;
}

/** True when every object's own keys are in code-unit order, at every depth. */
function keysSortedDeep(v: unknown): boolean {
  if (Array.isArray(v)) return v.every(keysSortedDeep);
  if (typeof v === "object" && v !== null) {
    const keys = Object.keys(v);
    const ok = keys.every((k, i) => i === 0 || keys[i - 1]! < k);
    return ok && Object.values(v).every(keysSortedDeep);
  }
  return true;
}

describe("Property 15: Backup round-trip and determinism", () => {
  it(
    "serialize → parse → serialize is byte-identical, parse returns the sorted input, and permutations serialize identically",
    async () => {
      await fc.assert(
        fc.asyncProperty(arbBackupData, arbTimestamp(), fc.integer(), async (data, exportedAt, seed) => {
          const text = await serializeBackup(data, exportedAt);

          // 17.7: 2-space indentation with sorted keys (canonical form).
          expect(text).toBe(JSON.stringify(JSON.parse(text), null, 2));
          expect(keysSortedDeep(JSON.parse(text))).toBe(true);

          // 17.3 / 17.8: parse succeeds and yields records equal to the canonical-sorted input.
          const parsed = await parseBackup(text, byteLen(text));
          expect(parsed.ok).toBe(true);
          if (!parsed.ok) return;
          expect(parsed.value).toEqual(sorted(data));

          // 17.8: serialize(parse(serialize(d))) === serialize(d).
          expect(await serializeBackup(parsed.value, exportedAt)).toBe(text);

          // 17.1 / 17.7: permuted collections and key orders give identical bytes.
          expect(await serializeBackup(permute(data, seed), exportedAt)).toBe(text);
        }),
        { numRuns: 100 },
      );
    },
    120_000,
  );
});

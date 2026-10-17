import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Chat, Memory, Message, Profile, Settings } from "@/core/models";
import { openDatabase } from "@/data/db";
import { createRepository, type ChangeEvent, type OperationContext, type Repo } from "@/data/repository";

let n = 0;
const freshName = () => `repo-test-${Date.now()}-${n++}`;

const T0 = "2024-05-01T10:00:00.000Z";
const T1 = "2024-05-01T10:05:00.000Z";

const profile = (id: string): Profile => ({ id, displayName: `User ${id}`, createdAt: T0, lastUsedAt: T1 });
const settings = (profileId: string, botName = "Sunny"): Settings => ({
  profileId,
  botName,
  tone: "calm",
  providerMode: "auto",
  ollamaBaseUrl: "http://localhost:11434",
  ollamaModel: "llama3.1:8b",
  geminiNoticeAcknowledgedAt: null,
  activityTrackingEnabled: false,
  notificationsEnabled: false,
  checkInTimeOverride: null,
  updatedAt: T0,
});
const chat = (id: string, profileId: string, updatedAt = T1): Chat => ({
  id,
  profileId,
  title: "Hello",
  mode: "text",
  createdAt: T0,
  updatedAt,
});
const message = (id: string, chatId: string, profileId: string, createdAt: string): Message => ({
  id,
  chatId,
  profileId,
  role: "user",
  content: `msg ${id}`,
  createdAt,
  safetyFlagged: false,
});
const memory = (id: string, profileId: string, chatId: string, messageId: string): Memory => ({
  id,
  profileId,
  category: "fact",
  content: "Likes tea",
  sourceChatIds: [chatId],
  sourceMessageIds: [messageId],
  createdAt: T1,
  updatedAt: T1,
});

const opA: OperationContext = { profileId: "pA", epoch: 0 };
const opB: OperationContext = { profileId: "pB", epoch: 0 };

let repo: Repo;

beforeEach(async () => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  repo = createRepository(await openDatabase(freshName()));
  expect(repo.mode).toBe("ready");
  for (const op of [opA, opB]) {
    expect(await repo.put(op, "profiles", profile(op.profileId))).toEqual({ ok: true, value: undefined });
  }
});

afterEach(() => {
  repo.close();
  vi.restoreAllMocks();
});

describe("repository", () => {
  it("round-trips valid records and emits a change event after commit", async () => {
    const events: ChangeEvent[] = [];
    repo.onChange((e) => events.push(e));

    const s = settings("pA");
    expect((await repo.put(opA, "settings", s)).ok).toBe(true);
    expect(await repo.getSettings("pA")).toEqual(s);

    const res = await repo.tx(opA, ["chats", "messages"], async (t) => {
      await t.put("chats", chat("c1", "pA"));
      await t.put("messages", message("m1", "c1", "pA", "2024-05-01T10:01:00.000Z"));
      await t.put("messages", message("m2", "c1", "pA", "2024-05-01T10:02:00.000Z"));
      await t.put("messages", message("m3", "c1", "pA", "2024-05-01T10:03:00.000Z"));
      return "done";
    });
    expect(res).toEqual({ ok: true, value: "done" });

    expect(await repo.listChats("pA")).toEqual([chat("c1", "pA")]);
    expect(await repo.listChats("pB")).toEqual([]);
    expect((await repo.messagesByChat("c1")).map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
    expect((await repo.messagesByChat("c1", { limit: 2 })).map((m) => m.id)).toEqual(["m2", "m3"]);
    expect(
      (await repo.messagesByChat("c1", { limit: 1, before: "2024-05-01T10:03:00.000Z" })).map((m) => m.id),
    ).toEqual(["m2"]);

    expect(events.at(-1)).toEqual({
      stores: ["chats", "messages"],
      profileId: "pA",
      ids: ["c1", "m1", "m2", "m3"],
      deleted: [],
    });
  });

  it("rejects an invalid record naming model and field, keeping the previous value", async () => {
    await repo.put(opA, "settings", settings("pA", "Sunny"));
    const listener = vi.fn();
    repo.onChange(listener);

    const res = await repo.put(opA, "settings", settings("pA", "x".repeat(31)));
    expect(res).toEqual({ ok: false, error: { kind: "validation", model: "settings", fields: ["botName"] } });
    expect((await repo.getSettings("pA"))?.botName).toBe("Sunny");
    expect(listener).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalled();
    // The log names the field but never the rejected value.
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain("x".repeat(31));
  });

  it("rejects writes for a profile other than the operation's profile", async () => {
    const res = await repo.put(opA, "settings", settings("pB"));
    expect(res).toEqual({ ok: false, error: { kind: "validation", model: "settings", fields: ["profileId"] } });
    expect(await repo.getSettings("pB")).toBeUndefined();

    await repo.put(opB, "chats", chat("cB", "pB"));
    const del = await repo.tx(opA, ["chats"], (t) => t.delete("chats", "cB"));
    expect(del.ok).toBe(false);
    expect(await repo.getChat("cB")).toBeDefined();
  });

  it("enforces referential integrity inside the transaction", async () => {
    await repo.put(opB, "chats", chat("cB", "pB"));
    // Missing profile.
    const missing = await repo.put({ profileId: "ghost", epoch: 0 }, "settings", settings("ghost"));
    expect(missing).toEqual({ ok: false, error: { kind: "validation", model: "settings", fields: ["profileId"] } });
    // Message in a chat of another profile.
    const crossChat = await repo.put(opA, "messages", message("m1", "cB", "pA", T1));
    expect(crossChat).toEqual({ ok: false, error: { kind: "validation", model: "messages", fields: ["chatId"] } });
    // Memory whose source message does not exist.
    await repo.put(opA, "chats", chat("cA", "pA"));
    const mem = await repo.put(opA, "memories", memory("mem1", "pA", "cA", "nope"));
    expect(mem).toEqual({ ok: false, error: { kind: "validation", model: "memories", fields: ["sourceMessageIds"] } });
    expect(await repo.memoriesByProfile("pA")).toEqual([]);

    // References created earlier in the same transaction are visible.
    const ok = await repo.tx(opA, ["messages", "memories"], async (t) => {
      await t.put("messages", message("m2", "cA", "pA", T1));
      await t.put("memories", memory("mem2", "pA", "cA", "m2"));
    });
    expect(ok.ok).toBe(true);
    expect((await repo.memoriesByProfile("pA")).map((m) => m.id)).toEqual(["mem2"]);
  });

  it("rolls back every write when a transaction fails", async () => {
    await repo.put(opA, "chats", chat("c1", "pA", T0));
    const listener = vi.fn();
    repo.onChange(listener);

    const thrown = await repo.tx(opA, ["chats", "messages"], async (t) => {
      await t.put("chats", chat("c1", "pA", T1));
      await t.put("messages", message("m1", "c1", "pA", T1));
      throw new Error("boom");
    });
    expect(thrown).toEqual({ ok: false, error: { kind: "write_failed", message: "Error: boom" } });

    const invalid = await repo.tx(opA, ["chats", "messages"], async (t) => {
      await t.put("chats", chat("c1", "pA", T1));
      await t.put("messages", { ...message("m1", "c1", "pA", T1), content: "" });
    });
    expect(invalid).toEqual({ ok: false, error: { kind: "validation", model: "messages", fields: ["content"] } });

    expect((await repo.getChat("c1"))?.updatedAt).toBe(T0);
    expect(await repo.messagesByChat("c1")).toEqual([]);
    expect(listener).not.toHaveBeenCalled();
  });

  it("returns stale when the staleness guard trips, and read_only without a database", async () => {
    let stale = false;
    const name = freshName();
    const guarded = createRepository(await openDatabase(name), { isStale: () => stale });
    await guarded.put(opA, "profiles", profile("pA"));
    const res = await guarded.tx(opA, ["settings"], async (t) => {
      await t.put("settings", settings("pA"));
      stale = true;
      await t.put("settings", settings("pA", "Late"));
    });
    expect(res).toEqual({ ok: false, error: { kind: "stale" } });
    expect(await guarded.getSettings("pA")).toBeUndefined();
    guarded.close();

    const ro = createRepository({ mode: "read_only", reason: "newer_version" });
    expect(ro.mode).toBe("read_only");
    expect(await ro.put(opA, "profiles", profile("pA"))).toEqual({ ok: false, error: { kind: "read_only" } });
    expect(await ro.getProfiles()).toEqual([]);
  });
});

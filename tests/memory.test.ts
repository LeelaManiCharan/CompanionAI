import { describe, expect, it } from "vitest";
import { appendCapped, forgetChat, mergeMemories, parseExtraction } from "@/core/memory";
import { MemorySchema, type Memory } from "@/core/models";

const T0 = "2024-05-01T10:00:00.000Z";
const T1 = "2024-05-02T10:00:00.000Z";

const mem = (over: Partial<Memory> = {}): Memory => ({
  id: "m1",
  profileId: "p1",
  category: "fact",
  content: "Has a dog named Rex",
  sourceChatIds: ["c1"],
  sourceMessageIds: ["u1"],
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

describe("parseExtraction", () => {
  it("parses valid output, tolerating code fences and whitespace", () => {
    const raw = '\n```json\n{"memories":[{"category":"mood","content":"  tired today "}]}\n```\n';
    expect(parseExtraction(raw)).toEqual({ ok: true, items: [{ category: "mood", content: "tired today" }] });
    expect(parseExtraction('{"memories":[]}')).toEqual({ ok: true, items: [] });
  });

  it("rejects non-JSON and wrong shapes", () => {
    expect(parseExtraction("I learned you like tea")).toEqual({ ok: false });
    expect(parseExtraction("[]")).toEqual({ ok: false });
    expect(parseExtraction('{"memories":{}}')).toEqual({ ok: false });
    expect(parseExtraction("null")).toEqual({ ok: false });
  });

  it("drops invalid items and keeps at most 5", () => {
    const valid = Array.from({ length: 7 }, (_, i) => ({ category: "fact", content: `fact ${i}` }));
    const raw = JSON.stringify({
      memories: [
        { category: "hobby", content: "x" },
        { category: "fact", content: "   " },
        { category: "fact", content: "a".repeat(501) },
        { category: "event", content: 3 },
        "nope",
        ...valid,
      ],
    });
    const res = parseExtraction(raw);
    expect(res.ok && res.items.map((i) => i.content)).toEqual(["fact 0", "fact 1", "fact 2", "fact 3", "fact 4"]);
  });
});

describe("appendCapped", () => {
  it("de-dupes, appends, and keeps the newest 100", () => {
    expect(appendCapped(["a", "b"], ["b", "c", "c"])).toEqual(["a", "b", "c"]);
    const list = Array.from({ length: 100 }, (_, i) => `id${i}`);
    const out = appendCapped(list, ["new1", "new2"]);
    expect(out).toHaveLength(100);
    expect(out.slice(0, 1)).toEqual(["id2"]);
    expect(out.slice(-2)).toEqual(["new1", "new2"]);
  });
});

describe("mergeMemories", () => {
  it("updates a case/whitespace-insensitive duplicate and creates new ones", () => {
    const existing = [mem()];
    let n = 0;
    const { upserts, createdCount } = mergeMemories(
      existing,
      [
        { category: "fact", content: "has a DOG named rex" },
        { category: "person", content: "Has a dog named Rex" },
        { category: "person", content: "has a dog named rex" },
      ],
      { profileId: "p1", chatId: "c2", messageIds: ["u2", "a2"] },
      T1,
      () => `new${++n}`,
    );
    expect(createdCount).toBe(1);
    expect(upserts).toHaveLength(2);
    const dup = upserts.find((m) => m.id === "m1")!;
    expect(dup.content).toBe("Has a dog named Rex");
    expect(dup.updatedAt).toBe(T1);
    expect(dup.sourceChatIds).toEqual(["c1", "c2"]);
    expect(dup.sourceMessageIds).toEqual(["u1", "u2", "a2"]);
    const created = upserts.find((m) => m.id === "new1")!;
    expect(created.category).toBe("person");
    expect(created.sourceChatIds).toEqual(["c2"]);
    for (const m of upserts) expect(MemorySchema.safeParse(m).success).toBe(true);
  });
});

describe("forgetChat", () => {
  it("deletes single-source memories and strips the chat from others", () => {
    const only = mem({ id: "only" });
    const shared = mem({ id: "shared", sourceChatIds: ["c1", "c2"], sourceMessageIds: ["u1", "u2"] });
    const msgsGone = mem({ id: "msgsGone", sourceChatIds: ["c1", "c2"], sourceMessageIds: ["u1"] });
    const other = mem({ id: "other", sourceChatIds: ["c3"], sourceMessageIds: ["u3"] });
    const { deleteIds, updates } = forgetChat([only, shared, msgsGone, other], "c1", new Set(["u1"]));
    expect(deleteIds.sort()).toEqual(["msgsGone", "only"]);
    expect(updates).toEqual([{ ...shared, sourceChatIds: ["c2"], sourceMessageIds: ["u2"] }]);
  });
});

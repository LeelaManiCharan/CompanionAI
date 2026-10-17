import { describe, expect, it } from "vitest";
import {
  MEMORIES_HEADING,
  SAFETY_INSTRUCTION,
  SUMMARY_HEADING,
  buildContext,
  buildExtractionRequest,
  buildSummaryRequest,
  rankMemories,
  requestBytes,
  trimToByteBudget,
  type ContextInput,
} from "@/core/context";
import type { GenerationRequest } from "@/core/generation";
import type { Memory, Message } from "@/core/models";

const ts = (n: number) => new Date(Date.UTC(2024, 0, 1) + n * 1000).toISOString();

const mem = (id: string, content: string, updated = 0, profileId = "p1"): Memory => ({
  id,
  profileId,
  category: "fact",
  content,
  sourceChatIds: ["c1"],
  sourceMessageIds: ["m1"],
  createdAt: ts(0),
  updatedAt: ts(updated),
});

const msg = (i: number, role: Message["role"] = "user"): Message => ({
  id: `m${String(i).padStart(3, "0")}`,
  chatId: "c1",
  profileId: "p1",
  role,
  content: `message ${i}`,
  createdAt: ts(i),
  safetyFlagged: false,
});

const input = (over: Partial<ContextInput> = {}): ContextInput => ({
  task: "reply",
  profileId: "p1",
  botName: "Sunny ☀",
  tone: "playful",
  summary: null,
  memories: [],
  chatMessages: [msg(1)],
  latestUserText: "message 1",
  safetyFlagged: false,
  provider: "ollama",
  ...over,
});

describe("rankMemories", () => {
  it("orders by token overlap, then updatedAt desc, then id, and keeps zero-score items", () => {
    const list = [mem("a", "likes tea", 1), mem("b", "has a dog named Rex", 1), mem("c", "walks the dog", 5), mem("d", "dog", 1)];
    expect(rankMemories(list, "My DOG, Rex!").map((m) => m.id)).toEqual(["b", "c", "d", "a"]);
    expect(rankMemories(list, "x", 2)).toHaveLength(2);
  });
});

describe("buildContext", () => {
  it("includes persona verbatim, rules, and omits summary/memory/safety sections when absent", () => {
    const req = buildContext(input());
    expect(req.system).toContain("You are Sunny ☀");
    expect(req.system).toContain("Your tone is playful.");
    expect(req.system).toContain("not a human");
    expect(req.system).toContain("therapist");
    expect(req.system).toContain("real-world relationships");
    expect(req.system).not.toContain(SUMMARY_HEADING);
    expect(req.system).not.toContain(MEMORIES_HEADING);
    expect(req.system).not.toContain(SAFETY_INSTRUCTION);
    expect(req.messages).toEqual([{ role: "user", content: "message 1" }]);
  });

  it("orders sections, filters other profiles, caps memories at 10 and messages at 20", () => {
    const memories = [
      ...Array.from({ length: 12 }, (_, i) => mem(`m${i}`, `memory ${i}`)),
      mem("other", "SECRET from p2", 99, "p2"),
    ];
    const chatMessages = Array.from({ length: 25 }, (_, i) => msg(i, i % 2 ? "companion" : "user")).reverse();
    const req = buildContext(input({ summary: "Loves hiking.", memories, chatMessages, safetyFlagged: true }));

    const iRules = req.system.indexOf("Rules:");
    const iSafety = req.system.indexOf(SAFETY_INSTRUCTION);
    const iSummary = req.system.indexOf(SUMMARY_HEADING);
    const iMem = req.system.indexOf(MEMORIES_HEADING);
    expect(0).toBeLessThan(iRules);
    expect(iRules).toBeLessThan(iSafety);
    expect(iSafety).toBeLessThan(iSummary);
    expect(iSummary).toBeLessThan(iMem);
    expect(req.system).not.toContain("SECRET");
    expect(req.system.slice(iMem).match(/^- \[/gm)).toHaveLength(10);

    expect(req.messages).toHaveLength(20);
    expect(req.messages[0]?.content).toBe("message 5");
    expect(req.messages[19]?.content).toBe("message 24");
  });

  it("trims to 64 KB for gemini only", () => {
    const big = (i: number): Message => ({ ...msg(i), content: "é".repeat(5_000) });
    const chatMessages = Array.from({ length: 20 }, (_, i) => big(i));
    expect(buildContext(input({ chatMessages })).messages).toHaveLength(20);
    const req = buildContext(input({ chatMessages, provider: "gemini" }));
    expect(requestBytes(req)).toBeLessThanOrEqual(65_536);
    expect(req.messages.length).toBeLessThan(20);
    expect(req.messages.at(-1)).toEqual({ role: "user", content: chatMessages[19]?.content });
  });
});

describe("trimToByteBudget", () => {
  const req: GenerationRequest = {
    task: "reply",
    system: "sys",
    messages: Array.from({ length: 5 }, (_, i) => ({ role: "user" as const, content: `${i}`.repeat(100) })),
  };

  it("returns the same request when already within budget", () => {
    expect(trimToByteBudget(req, 65_536)).toBe(req);
  });

  it("drops oldest messages first, keeps system and the final message", () => {
    const budget = requestBytes({ ...req, messages: req.messages.slice(3) });
    const out = trimToByteBudget(req, budget);
    expect(out.system).toBe("sys");
    expect(out.messages).toEqual(req.messages.slice(3));
    expect(trimToByteBudget(req, 10).messages).toEqual(req.messages.slice(4));
  });
});

describe("extraction and summary prompts", () => {
  it("builds an extract_memories request with JSON instructions", () => {
    const req = buildExtractionRequest({ userText: "I got a puppy", previousCompanionText: "How was your day?" });
    expect(req.task).toBe("extract_memories");
    expect(req.system).toContain('{"memories":[');
    expect(req.system).toContain("fact, mood, event, person");
    expect(req.messages.map((m) => m.role)).toEqual(["companion", "user"]);
  });

  it("builds a summarize request from the profile's memories only", () => {
    const req = buildSummaryRequest([mem("a", "likes tea"), mem("b", "OTHER", 0, "p2")], "p1");
    expect(req.task).toBe("summarize");
    expect(req.system).toContain("1500");
    expect(req.messages[0]?.content).toContain("likes tea");
    expect(req.messages[0]?.content).not.toContain("OTHER");
    expect(buildSummaryRequest([], "p1").messages[0]?.content.length).toBeGreaterThan(0);
  });
});

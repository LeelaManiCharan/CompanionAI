import { describe, expect, it } from "vitest";
import type { Chat, Message, Profile } from "@/core/models";
import { select } from "@/core/providerSelect";
import { HOME_CHAT_LIMIT, homeChatList, pickActiveProfile, sortMessages } from "@/core/selectors";

const ts = (n: number) => new Date(Date.UTC(2024, 0, 1) + n * 1000).toISOString();

const profile = (id: string, lastUsed: number): Profile => ({
  id,
  displayName: id,
  createdAt: ts(0),
  lastUsedAt: ts(lastUsed),
});

const chat = (id: string, updated: number, profileId = "p1"): Chat => ({
  id,
  profileId,
  title: id,
  mode: "text",
  createdAt: ts(0),
  updatedAt: ts(updated),
});

const msg = (id: string, chatId: string, at: number, profileId = "p1"): Message => ({
  id,
  chatId,
  profileId,
  role: "user",
  content: "hi",
  createdAt: ts(at),
  safetyFlagged: false,
});

describe("select", () => {
  it("auto prefers healthy Ollama, then online available Gemini, else none", () => {
    expect(select("auto", true, true, true)).toBe("ollama");
    expect(select("auto", true, false, false)).toBe("ollama");
    expect(select("auto", false, true, true)).toBe("gemini");
    expect(select("auto", false, true, false)).toBe("none");
    expect(select("auto", false, false, true)).toBe("none");
  });

  it("ollama mode never returns gemini", () => {
    expect(select("ollama", false, true, true)).toBe("ollama");
    expect(select("ollama", true, true, true)).toBe("ollama");
  });

  it("gemini mode never returns ollama and requires availability and connectivity", () => {
    expect(select("gemini", true, true, true)).toBe("gemini");
    expect(select("gemini", true, false, true)).toBe("none");
    expect(select("gemini", true, true, false)).toBe("none");
  });
});

describe("pickActiveProfile", () => {
  it("returns null for an empty list", () => {
    expect(pickActiveProfile([])).toBeNull();
  });

  it("picks the latest lastUsedAt, breaking ties by id regardless of order", () => {
    const list = [profile("b", 5), profile("c", 3), profile("a", 5)];
    expect(pickActiveProfile(list)?.id).toBe("a");
    expect(pickActiveProfile([...list].reverse())?.id).toBe("a");
  });
});

describe("homeChatList", () => {
  it("orders by latest message time desc, falls back to updatedAt, filters by profile", () => {
    const chats = [chat("c1", 1), chat("c2", 50), chat("c3", 10), chat("other", 99, "p2")];
    const messages = [msg("m1", "c1", 100), msg("m2", "c1", 20), msg("m3", "c3", 40), msg("x", "other", 200, "p2")];
    const list = homeChatList(chats, messages, "p1");
    expect(list.map((i) => i.chat.id)).toEqual(["c1", "c2", "c3"]);
    expect(list[0]?.lastMessageAt).toBe(ts(100));
    expect(list[1]?.lastMessageAt).toBe(ts(50));
  });

  it("caps at 50 and breaks ties by id", () => {
    const chats = Array.from({ length: 60 }, (_, i) => chat(`c${String(i).padStart(2, "0")}`, 5));
    const list = homeChatList([...chats].reverse(), [], "p1");
    expect(list).toHaveLength(HOME_CHAT_LIMIT);
    expect(list[0]?.chat.id).toBe("c00");
    expect(list[49]?.chat.id).toBe("c49");
  });
});

describe("sortMessages", () => {
  it("sorts ascending by createdAt with id tie-break and does not mutate input", () => {
    const input = [msg("b", "c", 2), msg("z", "c", 1), msg("a", "c", 2)];
    expect(sortMessages(input).map((m) => m.id)).toEqual(["z", "a", "b"]);
    expect(input.map((m) => m.id)).toEqual(["b", "z", "a"]);
  });
});

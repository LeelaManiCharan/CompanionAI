import { describe, expect, it } from "vitest";
import {
  CRISIS_FALLBACK_REPLY,
  CRISIS_PHRASES,
  VOICE_CRISIS_LINE,
  detectCrisis,
  normalizeForMatch,
} from "@/core/safety";

describe("normalizeForMatch", () => {
  it("lowercases, drops apostrophes, spaces punctuation, collapses whitespace", () => {
    expect(normalizeForMatch("  I DON'T   want…to-LIVE!!  ")).toBe("i dont want to live");
    expect(normalizeForMatch("Ｈｅｌｌｏ\u2019s\tworld")).toBe("hellos world");
    expect(normalizeForMatch("")).toBe("");
  });

  it("is idempotent on a sample", () => {
    const once = normalizeForMatch("Self-Harm?! ok…");
    expect(normalizeForMatch(once)).toBe(once);
  });
});

describe("detectCrisis", () => {
  it("flags crisis phrases despite case, punctuation, and whitespace", () => {
    expect(detectCrisis("Sometimes I want   to DIE.").flagged).toBe(true);
    expect(detectCrisis("i've been thinking about self-harm").matched).toContain("self harm");
    expect(detectCrisis("I don’t want to live anymore").flagged).toBe(true);
  });

  it("matches whole words only and ignores ordinary text", () => {
    expect(detectCrisis("Had a great day at work").flagged).toBe(false);
    expect(detectCrisis("I want to diet this month").flagged).toBe(false);
    expect(detectCrisis("").flagged).toBe(false);
  });

  it("phrase list is pre-normalized", () => {
    for (const p of CRISIS_PHRASES) expect(normalizeForMatch(p)).toBe(p);
  });
});

describe("crisis constants", () => {
  it("name 988 and 911", () => {
    expect(VOICE_CRISIS_LINE).toContain("988 Suicide and Crisis Lifeline");
    expect(VOICE_CRISIS_LINE).toContain("911");
    expect(CRISIS_FALLBACK_REPLY).toContain("988 Suicide and Crisis Lifeline");
  });
});

import { describe, expect, it } from "vitest";
import { MASK_CHAR, maskKey, redactSecrets } from "@/core/secrets";

describe("maskKey", () => {
  it("fully masks keys of 8 characters or fewer", () => {
    expect(maskKey("")).toBe("");
    expect(maskKey("abc")).toBe(MASK_CHAR.repeat(3));
    expect(maskKey("12345678")).toBe(MASK_CHAR.repeat(8));
  });

  it("reveals only the last 4 characters of longer keys", () => {
    expect(maskKey("123456789")).toBe(MASK_CHAR.repeat(5) + "6789");
    const key = "eyJhbGciOiJIUzI1NiJ9.secret-tail";
    const masked = maskKey(key);
    expect(masked).toHaveLength(key.length);
    expect(masked.endsWith("tail")).toBe(true);
    expect(masked.slice(0, -4)).toBe(MASK_CHAR.repeat(key.length - 4));
  });
});

describe("redactSecrets", () => {
  it("replaces every occurrence of each secret", () => {
    const out = redactSecrets("key=abc123 again abc123, other=zzz", ["abc123", "zzz"]);
    expect(out).not.toContain("abc123");
    expect(out).not.toContain("zzz");
    expect(out).toContain("key=");
  });

  it("ignores empty secrets and leaves clean messages unchanged", () => {
    expect(redactSecrets("hello", [""])).toBe("hello");
    expect(redactSecrets("hello", [])).toBe("hello");
  });

  it("handles secrets that collide with the replacement token", () => {
    for (const s of ["d", "[", "•", "*", "#", "]x"]) {
      const out = redactSecrets(`a${s}b d [ • * # ]x`, [s, "d"]);
      expect(out).not.toContain(s);
      expect(out).not.toContain("d");
    }
  });

  it("handles overlapping secrets", () => {
    const out = redactSecrets("xxabcdyy", ["abc", "bcd"]);
    expect(out).not.toContain("abc");
    expect(out).not.toContain("bcd");
    expect(out.startsWith("xx")).toBe(true);
    expect(out.endsWith("yy")).toBe(true);
  });
});

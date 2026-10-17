// Feature: ai-companion-checkin, Property 18: Encrypt/decrypt round-trip
// **Validates: Requirements 18.15, 18.20**
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HEADER_LEN, MIN_ITERATIONS, decryptBackup, encryptBackup } from "@/core/crypto";
import { arbUnicodeString } from "./arbitraries";

/** Test-only PBKDF2 cost; production uses DEFAULT_ITERATIONS. */
const ITER = MIN_ITERATIONS;
const MAX_PLAIN = 256 * 1024;

/** Mostly small plaintexts (≤ 4 KB) for speed, with occasional large ones up to 256 KB. */
const arbPlaintext: fc.Arbitrary<Uint8Array> = fc.oneof(
  { arbitrary: fc.uint8Array({ minLength: 0, maxLength: 4096 }), weight: 9 },
  { arbitrary: fc.uint8Array({ minLength: 4097, maxLength: MAX_PLAIN }), weight: 1 },
);

/** 8–128 code points, including non-ASCII and astral characters. */
const arbPassphrase = arbUnicodeString({ minLength: 8, maxLength: 128 });

const slice = (b: Uint8Array, start: number, end?: number) => Array.from(b.slice(start, end));

describe("Property 18: Encrypt/decrypt round-trip", () => {
  it(
    "decryptBackup(encryptBackup(p, pw), pw) returns p; repeated encryptions differ in salt, IV, ciphertext",
    async () => {
      await fc.assert(
        fc.asyncProperty(arbPlaintext, arbPassphrase, async (plain, pw) => {
          const a = await encryptBackup(plain, pw, { iterations: ITER });
          const b = await encryptBackup(plain, pw, { iterations: ITER });

          const res = await decryptBackup(a, pw);
          expect(res.ok).toBe(true);
          if (!res.ok) return;
          expect(res.value.byteLength).toBe(plain.byteLength);
          expect(Buffer.from(res.value).equals(Buffer.from(plain))).toBe(true);

          // Fresh random salt (bytes 8..24), IV (24..36) and therefore ciphertext per call.
          expect(slice(a, 8, 24)).not.toEqual(slice(b, 8, 24));
          expect(slice(a, 24, HEADER_LEN)).not.toEqual(slice(b, 24, HEADER_LEN));
          expect(Buffer.from(a.slice(HEADER_LEN)).equals(Buffer.from(b.slice(HEADER_LEN)))).toBe(false);
        }),
        { numRuns: 100 },
      );
    },
    120_000,
  );
});

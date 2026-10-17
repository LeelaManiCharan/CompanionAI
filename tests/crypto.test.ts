import { describe, expect, it } from "vitest";
import { HEADER_LEN, decryptBackup, encryptBackup } from "@/core/crypto";

const ITER = 1_000;
const enc = new TextEncoder();

describe("encryptBackup / decryptBackup", () => {
  it("round-trips plaintext with the correct passphrase", async () => {
    const plain = enc.encode('{"hello":"wörld 🌙"}');
    const blob = await encryptBackup(plain, "correct horse ✓", { iterations: ITER });
    expect(Array.from(blob.slice(0, 4))).toEqual([0x41, 0x43, 0x42, 0x31]);
    expect(new DataView(blob.buffer, blob.byteOffset).getUint32(4, false)).toBe(ITER);
    const res = await decryptBackup(blob, "correct horse ✓");
    expect(res.ok).toBe(true);
    if (res.ok) expect(Array.from(res.value)).toEqual(Array.from(plain));
  });

  it("round-trips empty plaintext and uses fresh salt/IV per call", async () => {
    const a = await encryptBackup(new Uint8Array(0), "passphrase", { iterations: ITER });
    const b = await encryptBackup(new Uint8Array(0), "passphrase", { iterations: ITER });
    expect(Array.from(a.slice(8, HEADER_LEN))).not.toEqual(Array.from(b.slice(8, HEADER_LEN)));
    const res = await decryptBackup(a, "passphrase");
    expect(res).toEqual({ ok: true, value: new Uint8Array(0) });
  });

  it("returns decrypt_failed for a wrong passphrase or tampered ciphertext", async () => {
    const blob = await encryptBackup(enc.encode("secret data"), "passphrase-1", { iterations: ITER });
    expect(await decryptBackup(blob, "passphrase-2")).toEqual({ ok: false, error: "decrypt_failed" });
    const tampered = blob.slice();
    tampered[HEADER_LEN] ^= 0x01;
    expect(await decryptBackup(tampered, "passphrase-1")).toEqual({ ok: false, error: "decrypt_failed" });
  });

  it("returns bad_header for short input, bad magic, or out-of-range iterations", async () => {
    const blob = await encryptBackup(enc.encode("x"), "passphrase", { iterations: ITER });
    expect(await decryptBackup(blob.slice(0, 10), "passphrase")).toEqual({ ok: false, error: "bad_header" });
    const badMagic = blob.slice();
    badMagic[0] = 0x00;
    expect(await decryptBackup(badMagic, "passphrase")).toEqual({ ok: false, error: "bad_header" });
    const badIter = blob.slice();
    new DataView(badIter.buffer).setUint32(4, 0xffffffff, false);
    expect(await decryptBackup(badIter, "passphrase")).toEqual({ ok: false, error: "bad_header" });
  });
});

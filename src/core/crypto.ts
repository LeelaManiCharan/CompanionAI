/**
 * Backup encryption framing (Req 18.15, 18.17, 18.18, 18.20).
 *
 * Layout: "ACB1" magic (4 B) ‖ PBKDF2 iterations uint32 BE (4 B) ‖ salt (16 B)
 *         ‖ IV (12 B) ‖ AES-GCM-256 ciphertext + 16 B tag.
 *
 * The key is derived with PBKDF2-SHA-256. The passphrase and derived CryptoKey
 * live only in function locals and are never persisted or returned (18.18).
 */

export const MAGIC = new Uint8Array([0x41, 0x43, 0x42, 0x31]); // "ACB1"
export const DEFAULT_ITERATIONS = 600_000;
export const MIN_ITERATIONS = 1_000;
export const MAX_ITERATIONS = 10_000_000;
const SALT_LEN = 16;
const IV_LEN = 12;
const TAG_LEN = 16;
export const HEADER_LEN = MAGIC.length + 4 + SALT_LEN + IV_LEN;

export type DecryptError = "decrypt_failed" | "bad_header";
export type DecryptResult = { ok: true; value: Uint8Array } | { ok: false; error: DecryptError };

function subtle(): SubtleCrypto {
  return globalThis.crypto.subtle;
}

/** Copies bytes into a fresh ArrayBuffer-backed array (Web Crypto BufferSource-safe). */
function copy(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(new ArrayBuffer(bytes.byteLength));
  out.set(bytes);
  return out;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
  usage: KeyUsage,
): Promise<CryptoKey> {
  const base = await subtle().importKey(
    "raw",
    copy(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

function validIterations(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_ITERATIONS && n <= MAX_ITERATIONS;
}

/** Encrypts `plain` with a fresh random salt and IV per call (18.15). */
export async function encryptBackup(
  plain: Uint8Array,
  passphrase: string,
  opts?: { iterations?: number },
): Promise<Uint8Array> {
  const iterations = opts?.iterations ?? DEFAULT_ITERATIONS;
  if (!validIterations(iterations)) {
    throw new RangeError(`iterations must be an integer in [${MIN_ITERATIONS}, ${MAX_ITERATIONS}]`);
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(SALT_LEN)));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_LEN)));
  const key = await deriveKey(passphrase, salt, iterations, "encrypt");
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, copy(plain)));

  const out = new Uint8Array(HEADER_LEN + ct.byteLength);
  out.set(MAGIC, 0);
  new DataView(out.buffer).setUint32(MAGIC.length, iterations, false);
  out.set(salt, MAGIC.length + 4);
  out.set(iv, MAGIC.length + 4 + SALT_LEN);
  out.set(ct, HEADER_LEN);
  return out;
}

/**
 * Decrypts a blob produced by `encryptBackup`. A short blob, wrong magic, or an
 * out-of-range iteration count yields `bad_header`; an authentication failure
 * (wrong passphrase or tampered salt/IV/ciphertext) yields `decrypt_failed` (18.17).
 */
export async function decryptBackup(blob: Uint8Array, passphrase: string): Promise<DecryptResult> {
  if (blob.byteLength < HEADER_LEN + TAG_LEN) return { ok: false, error: "bad_header" };
  for (let i = 0; i < MAGIC.length; i++) {
    if (blob[i] !== MAGIC[i]) return { ok: false, error: "bad_header" };
  }
  const bytes = copy(blob);
  const iterations = new DataView(bytes.buffer).getUint32(MAGIC.length, false);
  if (!validIterations(iterations)) return { ok: false, error: "bad_header" };

  const salt = bytes.slice(MAGIC.length + 4, MAGIC.length + 4 + SALT_LEN);
  const iv = bytes.slice(MAGIC.length + 4 + SALT_LEN, HEADER_LEN);
  const ct = bytes.slice(HEADER_LEN);
  try {
    const key = await deriveKey(passphrase, salt, iterations, "decrypt");
    const plain = await subtle().decrypt({ name: "AES-GCM", iv }, key, ct);
    return { ok: true, value: new Uint8Array(plain) };
  } catch (err) {
    if (err instanceof Error && err.name === "OperationError") {
      return { ok: false, error: "decrypt_failed" };
    }
    throw err;
  }
}

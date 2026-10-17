/**
 * Secret handling helpers (Requirements 7.4, 7.8).
 *
 * - `maskKey` renders a stored API key for display, revealing at most the
 *   last 4 characters. Keys of 8 characters or fewer are fully masked.
 * - `redactSecrets` removes every occurrence of any non-empty secret from a
 *   message before it is displayed or logged.
 */

export const MASK_CHAR = "•";

/** Number of trailing characters revealed for keys longer than `FULL_MASK_MAX_LENGTH`. */
const VISIBLE_TAIL = 4;
/** Keys with this many characters or fewer are fully masked. */
const FULL_MASK_MAX_LENGTH = 8;

/**
 * Masks an API key for display. The result has the same length as `key`
 * (in UTF-16 code units). Keys of length ≤ 8 are entirely mask characters;
 * longer keys keep exactly their last 4 characters.
 */
export function maskKey(key: string): string {
  const n = key.length;
  if (n <= FULL_MASK_MAX_LENGTH) return MASK_CHAR.repeat(n);
  return MASK_CHAR.repeat(n - VISIBLE_TAIL) + key.slice(n - VISIBLE_TAIL);
}

/** Candidate replacement tokens with pairwise-disjoint character sets. */
const REPLACEMENT_CANDIDATES = ["[redacted]", "•••", "***", "###"] as const;

/**
 * Replaces every occurrence of any non-empty secret in `message`.
 *
 * Guarantees the returned string contains none of the non-empty secrets, even
 * when secrets overlap each other or when a replacement token would combine
 * with adjacent text to form a secret.
 */
export function redactSecrets(message: string, secrets: readonly string[]): string {
  const active = Array.from(new Set(secrets.filter((s) => s.length > 0)));
  if (active.length === 0) return message;

  // Pick a replacement token that does not itself contain any secret. Because
  // the candidates have disjoint character sets, at most a few can be ruled
  // out; the empty string is the final fallback.
  const replacement =
    REPLACEMENT_CANDIDATES.find((r) => active.every((s) => !r.includes(s))) ?? "";

  // Each pass replaces every maximal run of characters covered by a secret
  // occurrence with a single replacement token. A new occurrence after a pass
  // must include text outside the token, so the output strictly shrinks and the
  // loop terminates.
  let current = message;
  for (;;) {
    const covered = coverage(current, active);
    if (covered === null) return current;
    let out = "";
    let i = 0;
    while (i < current.length) {
      if (covered[i]) {
        while (i < current.length && covered[i]) i++;
        out += replacement;
      } else {
        out += current[i];
        i++;
      }
    }
    current = out;
  }
}

/** Marks every index covered by an occurrence of any secret; null if none. */
function coverage(text: string, secrets: readonly string[]): boolean[] | null {
  let covered: boolean[] | null = null;
  for (const secret of secrets) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(secret, from);
      if (idx === -1) break;
      covered ??= new Array<boolean>(text.length).fill(false);
      for (let j = idx; j < idx + secret.length; j++) covered[j] = true;
      from = idx + 1; // allow overlapping occurrences
    }
  }
  return covered;
}

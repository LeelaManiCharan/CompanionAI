"use client";

import { useCallback, useState } from "react";

/**
 * Shows a just-chosen value until the live saved value moves off the one it
 * replaced (save committed) or the save fails (`revert`). Avoids a flicker
 * back to the old value between the write and the live query update.
 */
export function usePendingValue<T>(saved: T): [value: T, choose: (next: T) => void, revert: () => void] {
  const [pending, setPending] = useState<{ value: T; base: T } | null>(null);
  const value = pending && Object.is(saved, pending.base) ? pending.value : saved;
  const choose = useCallback((next: T) => setPending({ value: next, base: saved }), [saved]);
  const revert = useCallback(() => setPending(null), []);
  return [value, choose, revert];
}

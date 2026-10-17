"use client";

import { useSyncExternalStore } from "react";

/** Shared 30 s wall clock so relative times, greetings and "today" stay current. */
const TICK_MS = 30_000;

let now = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  if (!timer) {
    now = Date.now();
    timer = setInterval(() => {
      now = Date.now();
      for (const l of [...listeners]) l();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && timer) {
      clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  // Stable between calls (useSyncExternalStore requirement); refreshed by subscribe/tick.
  if (now === 0) now = Date.now();
  return now;
}

const getServerSnapshot = (): number => 0;

/** Current epoch ms, refreshed every 30 s (0 during SSR). */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

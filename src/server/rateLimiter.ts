/**
 * In-memory sliding-window Rate_Limiter (Req 6A.5, 6A.6).
 *
 * Best-effort only: state lives in this server instance and resets on restart.
 * No Next-specific imports so it can be used by route handlers and vitest.
 */

export const RATE_LIMIT_MAX = 20;
export const RATE_LIMIT_WINDOW_MS = 60_000;
/** Upper bound on tracked IPs; stale entries are pruned before this is enforced. */
export const RATE_LIMIT_MAX_KEYS = 10_000;

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the next request would be allowed (0 when allowed). */
  retryAfterS: number;
}

export interface RateLimiter {
  check(ip: string): RateLimitResult;
  /** Number of IPs currently tracked (for tests / diagnostics). */
  size(): number;
}

export interface RateLimiterOptions {
  max?: number;
  windowMs?: number;
  maxKeys?: number;
  now?: () => number;
}

export function createRateLimiter(opts: RateLimiterOptions = {}): RateLimiter {
  const max = opts.max ?? RATE_LIMIT_MAX;
  const windowMs = opts.windowMs ?? RATE_LIMIT_WINDOW_MS;
  const maxKeys = opts.maxKeys ?? RATE_LIMIT_MAX_KEYS;
  const now = opts.now ?? Date.now;
  const hits = new Map<string, number[]>();
  let lastPrune = -Infinity;

  function prune(t: number): void {
    for (const [ip, times] of hits) {
      const last = times[times.length - 1];
      if (last === undefined || t - last >= windowMs) hits.delete(ip);
    }
    lastPrune = t;
  }

  return {
    check(ip: string): RateLimitResult {
      const t = now();
      // Periodic prune of IPs whose newest hit is outside the window.
      if (t - lastPrune >= windowMs || hits.size >= maxKeys) prune(t);

      const times = (hits.get(ip) ?? []).filter((x) => t - x < windowMs);
      if (times.length >= max) {
        hits.set(ip, times);
        const oldest = times[0];
        const retryAfterS = Math.max(1, Math.ceil((oldest + windowMs - t) / 1000));
        return { allowed: false, retryAfterS };
      }

      // Hard cap: if still full after pruning, evict the oldest-inserted key.
      if (!hits.has(ip) && hits.size >= maxKeys) {
        const firstKey = hits.keys().next().value;
        if (firstKey !== undefined) hits.delete(firstKey);
      }
      times.push(t);
      hits.delete(ip); // re-insert to keep Map order ~ recency
      hits.set(ip, times);
      return { allowed: true, retryAfterS: 0 };
    },
    size: () => hits.size,
  };
}

type HeaderSource = Headers | { get(name: string): string | null };

/** Client IP: first `x-forwarded-for` entry, else `x-real-ip`, else "unknown". */
export function clientIp(headers: HeaderSource): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "unknown";
}

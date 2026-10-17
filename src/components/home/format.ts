/** Small display helpers for the Home dashboard. All output uses the browser's local time zone. */

export type DayPart = "morning" | "afternoon" | "evening";

export function dayPart(nowMs: number): DayPart {
  const h = new Date(nowMs).getHours();
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 18) return "afternoon";
  return "evening";
}

/** Short zone label for the given instant, e.g. "GMT+1" or "PST"; empty if unavailable. */
export function zoneLabel(nowMs: number): string {
  try {
    const part = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" })
      .formatToParts(new Date(nowMs))
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "";
  } catch {
    return "";
  }
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Compact relative time: "Just now", "12m ago", "3h ago", "Yesterday", "Tue", "4 Mar", "4 Mar 2023". */
export function relativeTime(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = nowMs - t;
  if (diff < MINUTE) return "Just now";
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  const today = startOfDay(nowMs);
  if (t >= today) return `${Math.floor(diff / HOUR)}h ago`;
  if (t >= today - DAY) return "Yesterday";
  if (t >= today - 6 * DAY) return new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(t);
  const sameYear = new Date(t).getFullYear() === new Date(nowMs).getFullYear();
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: sameYear ? undefined : "numeric",
  }).format(t);
}

/** Full local date and time for tooltips / screen readers. */
export function fullDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(t);
}

/** Local `HH:MM` (24 h) of an instant. */
export function clockTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

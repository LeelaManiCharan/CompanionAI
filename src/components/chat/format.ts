/** Date/time formatting for the chat UI (local time zone). */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function startOfDay(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole local calendar days between two instants (0 = same day). */
export function dayDiff(a: number, b: number): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / (24 * HOUR));
}

/** Compact relative time for the chat rail: "now", "12m", "3h", "Yesterday", "Mon", "Jan 5", "Jan 5, 2024". */
export function relativeTime(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const diff = now - t;
  if (diff < MINUTE) return "now";
  const days = dayDiff(t, now);
  if (days === 0) return diff < HOUR ? `${Math.floor(diff / MINUTE)}m` : `${Math.floor(diff / HOUR)}h`;
  if (days === 1) return "Yesterday";
  const d = new Date(t);
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "short" });
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: sameYear ? undefined : "numeric" });
}

/** Clock time for a message, e.g. "9:41 AM". */
export function clockTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/** Full date and time for tooltips. */
export function fullDateTime(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return new Date(t).toLocaleString(undefined, { dateStyle: "full", timeStyle: "short" });
}

/** Day divider label: "Today", "Yesterday", "Mon, Jan 5", "Mon, Jan 5, 2024". */
export function dayLabel(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const days = dayDiff(t, now);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  });
}

/** Local calendar-day key for grouping. */
export function dayKey(iso: string): string {
  const d = new Date(Date.parse(iso));
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

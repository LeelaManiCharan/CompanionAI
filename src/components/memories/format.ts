/**
 * Display formatting for timestamps and durations (Memories, Activity, and
 * Profiles pages). Pages render client-side only (under AppRoot), so the
 * browser locale and time zone are used without hydration concerns.
 */

const dateTime = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dayLabel = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" });
const dayLabelWithYear = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

const valid = (d: Date) => !Number.isNaN(d.getTime());

/** "Jan 6, 2025, 09:12". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return valid(d) ? dateTime.format(d) : "—";
}

/** "Mon, Jan 6" (year added when not the current year). */
export function formatDay(iso: string): string {
  const d = new Date(iso);
  if (!valid(d)) return "—";
  return d.getFullYear() === new Date().getFullYear() ? dayLabel.format(d) : dayLabelWithYear.format(d);
}

/** "09:12". */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  return valid(d) ? timeOnly.format(d) : "—";
}

export function sameLocalDay(a: string, b: string): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** "just now", "5 min ago", "yesterday", "3 days ago", else a date. */
export function formatRelative(iso: string, now: number = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const sec = Math.round((t - now) / 1000);
  const abs = Math.abs(sec);
  if (abs < 45) return "just now";
  if (abs < 3600) return relative.format(Math.round(sec / 60), "minute");
  if (abs < 86_400) return relative.format(Math.round(sec / 3600), "hour");
  if (abs < 86_400 * 7) return relative.format(Math.round(sec / 86_400), "day");
  return formatDay(iso);
}

/** Under an hour: "mm:ss"; otherwise "1h 05m". */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 3600) {
    const m = Math.floor(s / 60);
    return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  }
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

/** Spoken form for screen readers: "1 hour 5 minutes", "12 minutes 3 seconds". */
export function durationLabel(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hour${h === 1 ? "" : "s"}`);
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (!h && (sec || parts.length === 0)) parts.push(`${sec} second${sec === 1 ? "" : "s"}`);
  return parts.join(" ");
}

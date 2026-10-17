/** Display helpers for backup metadata (18.3, 18.6). */

const KB = 1024;
const MB = KB * 1024;

/** Size in KB or MB with one decimal place (18.3). */
export function formatBackupSize(bytes: number): string {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  if (n < MB) return `${(n / KB).toFixed(1)} KB`;
  return `${(n / MB).toFixed(1)} MB`;
}

/** Local date and time with minute precision (18.3). */
export function formatBackupTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "Unknown time";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(ms);
}

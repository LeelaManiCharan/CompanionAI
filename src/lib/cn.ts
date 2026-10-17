/**
 * Tiny className joiner. Accepts strings, falsy values, arrays, and
 * `{ className: condition }` maps. No dedupe or Tailwind conflict merging:
 * callers should avoid passing classes that fight the component's own.
 */
export type ClassValue =
  | string
  | number
  | null
  | undefined
  | false
  | ClassValue[]
  | Record<string, boolean | null | undefined>;

export function cn(...inputs: ClassValue[]): string {
  const out: string[] = [];
  const walk = (v: ClassValue): void => {
    if (!v && v !== 0) return;
    if (typeof v === "string" || typeof v === "number") {
      out.push(String(v));
    } else if (Array.isArray(v)) {
      v.forEach(walk);
    } else if (typeof v === "object") {
      for (const [key, on] of Object.entries(v)) if (on) out.push(key);
    }
  };
  inputs.forEach(walk);
  return out.join(" ");
}

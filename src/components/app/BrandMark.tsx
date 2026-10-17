import { cn } from "@/lib/cn";

/** Small dark-green mark: a sunrise over the horizon (a new day, a new check-in). */
export function BrandMark({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
    >
      <rect width="24" height="24" rx="7" className="fill-primary" />
      <path d="M7.25 15a4.75 4.75 0 0 1 9.5 0" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path d="M5.75 17.75h12.5" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 6.25v1.5" fill="none" stroke="#fff" strokeOpacity="0.7" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

/** Mark + "Companion" wordmark in Geist. */
export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <BrandMark size={22} />
      <span className="text-[15px] font-semibold tracking-[-0.03em] text-text">Companion</span>
    </span>
  );
}

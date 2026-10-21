import { cn } from "@/lib/cn";

export type AvatarActivity = "idle" | "listening" | "speaking" | "still";

export type CallAvatarProps = {
  botName: string;
  activity: AvatarActivity;
  /** Dims the avatar (unsupported, ended, muted). */
  dimmed?: boolean;
  className?: string;
};

/**
 * Large circular avatar with the Bot_Name initial. Rings breathe softly while
 * listening and pulse outward while speaking; they hold still otherwise.
 * Animations are switched off under `prefers-reduced-motion`.
 */
export function CallAvatar({ botName, activity, dimmed = false, className }: CallAvatarProps) {
  const initial = (botName.trim()[0] ?? "?").toUpperCase();

  return (
    <div aria-hidden="true" className={cn("relative grid size-44 place-items-center sm:size-52", className)}>
      {/* Outer static halo */}
      <span className="absolute inset-[-18px] rounded-full border border-white/10" />

      {activity === "listening" && (
        <span className="absolute inset-[-8px] rounded-full border-2 border-white/50 animate-ring-soft motion-reduce:animate-none motion-reduce:opacity-40" />
      )}

      {activity === "speaking" && (
        <>
          <span className="absolute inset-0 rounded-full border-2 border-white/70 animate-ring-strong motion-reduce:hidden" />
          <span className="absolute inset-0 rounded-full border-2 border-white/60 animate-ring-strong [animation-delay:600ms] motion-reduce:hidden" />
          <span className="absolute inset-[-8px] hidden rounded-full border-2 border-white/60 motion-reduce:block" />
        </>
      )}

      {activity === "still" && <span className="absolute inset-[-8px] rounded-full border-2 border-white/20" />}

      <span
        className={cn(
          "relative grid size-full place-items-center rounded-full border border-white/25 bg-gradient-to-br from-white/20 to-white/5",
          "text-6xl font-semibold tracking-[-0.04em] text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.12)] sm:text-7xl",
          "transition-opacity duration-300",
          dimmed && "opacity-60",
        )}
      >
        {initial}
      </span>
    </div>
  );
}

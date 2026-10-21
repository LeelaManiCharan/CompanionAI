/** Shared classes for controls on the dark call screen. */

const focus = "focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white";

const pill =
  "inline-flex h-12 shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full px-6 " +
  "text-[15px] font-semibold tracking-[-0.01em] transition-colors duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 " +
  focus;

/** White pill with deep-green text: the main action on the dark screen. */
export const lightPill = `${pill} bg-white text-primary-deep shadow-[0_8px_24px_rgb(0_0_0/0.25)] hover:bg-white/90 active:scale-[0.98] active:bg-white/80`;

/** Outlined pill for secondary actions. */
export const outlinePill = `${pill} border border-white/30 bg-white/5 text-white hover:bg-white/10 active:bg-white/15`;

/** Large round control (mute / end). */
export const roundControl =
  "inline-grid shrink-0 place-items-center rounded-full transition-colors duration-150 " +
  "disabled:cursor-not-allowed disabled:opacity-40 " +
  focus;

/** Small top-bar link. */
export const topBarLink =
  "inline-flex h-9 items-center gap-1 rounded-md px-2 text-sm font-medium text-white/85 transition-colors " +
  "hover:bg-white/10 hover:text-white " +
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white";

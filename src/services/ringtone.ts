/**
 * Synthesized phone ringtone for incoming companion "calls" (reminders and
 * Daily_Check_Ins). Web Audio only, no audio files. Browser-only; every
 * function is SSR-safe and a no-op where Web Audio is missing.
 *
 * Pattern: a two-tone (440 Hz + 480 Hz) ring, 2 s on / 3 s off, with a soft
 * attack/release envelope. Loops until `stopRingtone()` or `RING_MAX_MS`.
 *
 * Autoplay policies only let an AudioContext run after a user gesture, so
 * `primeAudio()` is attached once to the first pointerdown/keydown and
 * creates/resumes the context then; later rings can start without a gesture.
 */

export const RINGTONE_PREF_KEY = "companion:ringtone";
/** Hard stop for an unanswered ring. */
export const RING_MAX_MS = 45_000;
const ON_S = 2;
const CYCLE_S = 5;
const PEAK_GAIN = 0.12;
const FADE_S = 0.08;
/** Ring cycles scheduled ahead of the audio clock. */
const LOOKAHEAD_CYCLES = 2;

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let ringing = false;
let nextCycleAt = 0;
let pump: ReturnType<typeof setInterval> | null = null;
let maxTimer: ReturnType<typeof setTimeout> | null = null;
let oscillators: OscillatorNode[] = [];
const listeners = new Set<() => void>();

function audioCtor(): AudioContextCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor };
  return w.AudioContext ?? w.webkitAudioContext ?? null;
}

function emit(): void {
  for (const l of [...listeners]) {
    try {
      l();
    } catch {
      // ignore
    }
  }
}

function getContext(): AudioContext | null {
  if (ctx && ctx.state !== "closed") return ctx;
  const Ctor = audioCtor();
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    ctx = null;
  }
  return ctx;
}

/** Whether the user wants a ringtone (localStorage `companion:ringtone`, default on). */
export function isRingtoneEnabled(): boolean {
  try {
    return window.localStorage.getItem(RINGTONE_PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

export function setRingtoneEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(RINGTONE_PREF_KEY, enabled ? "on" : "off");
  } catch {
    // Storage unavailable: the default (on) applies.
  }
  if (!enabled) stopRingtone();
  emit();
}

/** Creates/resumes the AudioContext; call from a user gesture. */
export function primeAudio(): void {
  const c = getContext();
  if (c && c.state === "suspended") void c.resume().catch(() => undefined);
}

/**
 * Attaches `primeAudio` to the first pointerdown/keydown (capture phase).
 * Returns a detach function. Safe to call more than once.
 */
export function attachAudioPrimer(): () => void {
  if (typeof window === "undefined") return () => {};
  const onGesture = () => {
    primeAudio();
    // Keep listening until the context actually runs (some browsers need a "real" activation).
    if (ctx?.state === "running") detach();
  };
  const detach = () => {
    window.removeEventListener("pointerdown", onGesture, true);
    window.removeEventListener("keydown", onGesture, true);
  };
  window.addEventListener("pointerdown", onGesture, true);
  window.addEventListener("keydown", onGesture, true);
  return detach;
}

/** Schedules one 2 s two-tone burst starting at `t` (audio clock seconds). */
function scheduleBurst(c: AudioContext, out: GainNode, t: number): void {
  const env = c.createGain();
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(PEAK_GAIN, t + FADE_S);
  env.gain.setValueAtTime(PEAK_GAIN, t + ON_S - FADE_S);
  env.gain.linearRampToValueAtTime(0, t + ON_S);
  env.connect(out);
  for (const freq of [440, 480]) {
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(env);
    osc.start(t);
    osc.stop(t + ON_S + 0.02);
    oscillators.push(osc);
    osc.onended = () => {
      oscillators = oscillators.filter((o) => o !== osc);
      try {
        osc.disconnect();
      } catch {
        // ignore
      }
    };
  }
}

function fillAhead(): void {
  if (!ringing || !ctx || !master) return;
  const horizon = ctx.currentTime + LOOKAHEAD_CYCLES * CYCLE_S;
  if (nextCycleAt < ctx.currentTime) nextCycleAt = ctx.currentTime + 0.05;
  while (nextCycleAt < horizon) {
    scheduleBurst(ctx, master, nextCycleAt);
    nextCycleAt += CYCLE_S;
  }
}

/** Starts ringing (no-op when already ringing, disabled, or unsupported). */
export function startRingtone(): void {
  if (ringing || !isRingtoneEnabled()) return;
  const c = getContext();
  if (!c) return;
  ringing = true;
  if (c.state === "suspended") void c.resume().catch(() => undefined);
  master = c.createGain();
  master.gain.value = 1;
  master.connect(c.destination);
  nextCycleAt = c.currentTime + 0.05;
  fillAhead();
  pump = setInterval(fillAhead, 1000);
  maxTimer = setTimeout(stopRingtone, RING_MAX_MS);
  emit();
}

/** Stops ringing immediately. Idempotent. */
export function stopRingtone(): void {
  if (!ringing) return;
  ringing = false;
  if (pump) clearInterval(pump);
  pump = null;
  if (maxTimer) clearTimeout(maxTimer);
  maxTimer = null;
  for (const osc of oscillators.splice(0)) {
    try {
      osc.stop();
    } catch {
      // not started / already stopped
    }
  }
  try {
    master?.disconnect();
  } catch {
    // ignore
  }
  master = null;
  emit();
}

export function isRinging(): boolean {
  return ringing;
}

/** For `useSyncExternalStore(subscribeRingtone, isRinging, () => false)`. */
export function subscribeRingtone(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

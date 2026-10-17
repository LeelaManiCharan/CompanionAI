/**
 * Browser speech adapter (Req 5.2, 5.6, 5.9, 5.12; design "Voice call controller").
 *
 * Thin wrappers around `SpeechRecognition` and `speechSynthesis` that turn
 * browser quirks into the small set of events the call machine understands.
 * Everything here is SSR-safe: nothing touches `window` at import time.
 */

type RecognitionCtor = new () => SpeechRecognition;

const isBrowser = (): boolean => typeof window !== "undefined";

function recognitionCtor(): RecognitionCtor | null {
  if (!isBrowser()) return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Whether this browser can run a voice call (Speech_Recognizer + Speech_Synthesizer). */
export function speechSupported(): boolean {
  return recognitionCtor() !== null && isBrowser() && "speechSynthesis" in window;
}

/** BCP 47 language for recognition and voice selection. */
export function speechLang(): string {
  if (typeof navigator === "undefined") return "en-US";
  return navigator.language || "en-US";
}

// ---------------------------------------------------------------------------
// Microphone permission
// ---------------------------------------------------------------------------

/**
 * Asks for microphone access (Req 5.2) and releases the stream right away;
 * the recognizer opens its own capture. Resolves false on denial, dismissal,
 * missing hardware, or an insecure context.
 */
export async function requestMicrophone(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return false;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Recognizer
// ---------------------------------------------------------------------------

export interface RecognizerHandlers {
  /** The user started talking (speechstart or first result of a session). */
  onSpeechStart: () => void;
  /** Interim text for live display; empty string clears it. */
  onInterim: (text: string) => void;
  /** A final transcript. */
  onFinal: (text: string) => void;
  /** The recognizer stopped on its own because of a real failure (Req 5.12). */
  onStopped: (reason: string) => void;
}

export interface Recognizer {
  start: () => void;
  stop: () => void;
  /** Stops and detaches for good. */
  dispose: () => void;
}

/** Errors that are part of normal operation (silence, our own abort). */
const BENIGN_ERRORS = new Set(["no-speech", "aborted"]);
/** Silent keep-alive restarts faster than this are treated as a failure loop. */
const MIN_SESSION_MS = 600;
const MAX_FAST_RESTARTS = 4;

/**
 * Creates a recognizer that stays open across browser silence timeouts.
 *
 * Chrome ends a session after a few seconds of silence (often with a
 * `no-speech` error). Those ends are restarted here silently so they do not
 * count against the 3-restart limit of the call machine; only real errors
 * (network, audio-capture, not-allowed, ...) or a restart loop surface as
 * `onStopped`. Each `start()` uses a fresh instance so late events from an
 * older session are ignored.
 */
export function createRecognizer(handlers: RecognizerHandlers, lang = speechLang()): Recognizer {
  const Ctor = recognitionCtor();
  let current: SpeechRecognition | null = null;
  let session = 0;
  let wanted = false;
  let disposed = false;
  let fastRestarts = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;

  const clearRetry = () => {
    if (retryTimer !== null) clearTimeout(retryTimer);
    retryTimer = null;
  };

  const detach = (rec: SpeechRecognition | null) => {
    if (!rec) return;
    rec.onstart = null;
    rec.onspeechstart = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try {
      rec.abort();
    } catch {
      /* already stopped */
    }
  };

  const fail = (reason: string) => {
    wanted = false;
    clearRetry();
    detach(current);
    current = null;
    handlers.onInterim("");
    handlers.onStopped(reason);
  };

  const open = () => {
    if (!Ctor) {
      // Report asynchronously so the caller's dispatch has finished.
      retryTimer = setTimeout(() => fail("unsupported"), 0);
      return;
    }
    detach(current);
    const id = ++session;
    const rec = new Ctor();
    current = rec;
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    let startedAt = Date.now();
    let heardSpeech = false;
    let lastError: string | null = null;

    const live = () => id === session && wanted && !disposed;

    rec.onstart = () => {
      startedAt = Date.now();
    };
    rec.onspeechstart = () => {
      if (!live() || heardSpeech) return;
      heardSpeech = true;
      handlers.onSpeechStart();
    };
    rec.onresult = (ev: SpeechRecognitionEvent) => {
      if (!live()) return;
      if (!heardSpeech) {
        heardSpeech = true;
        handlers.onSpeechStart();
      }
      fastRestarts = 0;
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const result = ev.results[i];
        const text = result[0]?.transcript ?? "";
        if (result.isFinal) {
          handlers.onInterim("");
          handlers.onFinal(text);
          // The controller usually stops us here; bail if it did.
          if (!live()) return;
        } else {
          interim += text;
        }
      }
      handlers.onInterim(interim.trim());
    };
    rec.onerror = (ev: SpeechRecognitionErrorEvent) => {
      if (id !== session) return;
      lastError = ev.error;
    };
    rec.onend = () => {
      if (!live()) return;
      handlers.onInterim("");
      if (lastError && !BENIGN_ERRORS.has(lastError)) {
        fail(lastError);
        return;
      }
      // Silent keep-alive restart, with a guard against tight loops.
      const short = Date.now() - startedAt < MIN_SESSION_MS;
      fastRestarts = short ? fastRestarts + 1 : 0;
      if (fastRestarts > MAX_FAST_RESTARTS) {
        fail(lastError ?? "ended");
        return;
      }
      retryTimer = setTimeout(
        () => {
          retryTimer = null;
          if (wanted && !disposed) open();
        },
        short ? 250 : 0,
      );
    };

    try {
      rec.start();
    } catch {
      retryTimer = setTimeout(() => fail("start-failed"), 0);
    }
  };

  return {
    start() {
      if (disposed) return;
      clearRetry();
      wanted = true;
      fastRestarts = 0;
      open();
    },
    stop() {
      wanted = false;
      clearRetry();
      session++;
      detach(current);
      current = null;
      handlers.onInterim("");
    },
    dispose() {
      this.stop();
      disposed = true;
    },
  };
}

// ---------------------------------------------------------------------------
// Synthesizer
// ---------------------------------------------------------------------------

/** Voices known to sound natural, best first (matched by substring). */
const PREFERRED_VOICES = [
  "natural",
  "neural",
  "google",
  "aria",
  "jenny",
  "samantha",
  "ava",
  "allison",
  "serena",
  "daniel",
  "karen",
  "moira",
  "zira",
];

function scoreVoice(v: SpeechSynthesisVoice, lang: string): number {
  const vl = v.lang.toLowerCase().replace("_", "-");
  const want = lang.toLowerCase();
  const base = want.split("-")[0];
  let score = 0;
  if (vl === want) score += 100;
  else if (vl.split("-")[0] === base) score += 60;
  else return -1;
  const name = v.name.toLowerCase();
  const idx = PREFERRED_VOICES.findIndex((p) => name.includes(p));
  if (idx >= 0) score += 40 - idx;
  if (v.default) score += 5;
  return score;
}

/** Picks a pleasant voice for `lang`, or null to use the browser default. */
export function pickVoice(lang = speechLang()): SpeechSynthesisVoice | null {
  if (!isBrowser() || !("speechSynthesis" in window)) return null;
  let best: SpeechSynthesisVoice | null = null;
  let bestScore = -1;
  for (const v of window.speechSynthesis.getVoices()) {
    const s = scoreVoice(v, lang);
    if (s > bestScore) {
      best = v;
      bestScore = s;
    }
  }
  return best;
}

export interface Synthesizer {
  /** Speaks `text`, cancelling anything queued. `onEnd` fires exactly once. */
  speak: (text: string, onEnd: () => void) => void;
  cancel: () => void;
  dispose: () => void;
}

/**
 * Unlocks speech output while we are still inside the user's click (some
 * engines refuse to speak without a recent gesture). Speaks a silent blank.
 */
export function primeSpeech(): void {
  if (!isBrowser() || !("speechSynthesis" in window)) return;
  try {
    const u = new SpeechSynthesisUtterance(" ");
    u.volume = 0;
    window.speechSynthesis.speak(u);
  } catch {
    /* best effort */
  }
}

/** Chrome pauses long utterances after ~15 s unless nudged. */
const KEEPALIVE_MS = 10_000;

export function createSynthesizer(lang = speechLang()): Synthesizer {
  const synth = isBrowser() && "speechSynthesis" in window ? window.speechSynthesis : null;
  let voice: SpeechSynthesisVoice | null = pickVoice(lang);
  let token = 0;
  // Holding a reference stops Chrome from garbage-collecting the utterance (lost `end`).
  let utterance: SpeechSynthesisUtterance | null = null;
  let keepAlive: ReturnType<typeof setInterval> | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  const isAndroid = typeof navigator !== "undefined" && /android/i.test(navigator.userAgent);

  const onVoices = () => {
    voice = pickVoice(lang);
  };
  synth?.addEventListener?.("voiceschanged", onVoices);

  const clearTimers = () => {
    if (keepAlive !== null) clearInterval(keepAlive);
    if (watchdog !== null) clearTimeout(watchdog);
    keepAlive = null;
    watchdog = null;
  };

  const cancel = () => {
    token++;
    clearTimers();
    if (utterance) {
      utterance.onend = null;
      utterance.onerror = null;
    }
    utterance = null;
    try {
      synth?.cancel();
    } catch {
      /* nothing to cancel */
    }
  };

  return {
    speak(text, onEnd) {
      cancel();
      const id = token;
      let done = false;
      const finish = () => {
        if (done || id !== token) return;
        done = true;
        clearTimers();
        utterance = null;
        onEnd();
      };

      if (!synth) {
        setTimeout(finish, 0);
        return;
      }

      const u = new SpeechSynthesisUtterance(text);
      u.lang = voice?.lang ?? lang;
      if (voice) u.voice = voice;
      u.rate = 1;
      u.pitch = 1;
      u.volume = 1;
      u.onend = finish;
      u.onerror = finish;
      utterance = u;

      // If `end` never fires (known engine bugs), move on after a generous estimate.
      const estimateMs = 4_000 + text.length * 110;
      watchdog = setTimeout(finish, estimateMs);
      if (!isAndroid) {
        keepAlive = setInterval(() => {
          if (!synth.speaking) return;
          synth.pause();
          synth.resume();
        }, KEEPALIVE_MS);
      }

      try {
        synth.speak(u);
      } catch {
        setTimeout(finish, 0);
      }
    },
    cancel,
    dispose() {
      cancel();
      synth?.removeEventListener?.("voiceschanged", onVoices);
    },
  };
}

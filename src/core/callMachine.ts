/**
 * Voice call state machine (Req 5, 14.3, 20.31). Pure: `(state, event) →
 * { state, effects }`. Effects are plain data the speech adapter executes.
 * Every timestamp comes in on the event; nothing here reads the clock.
 */
import { detectCrisis, normalizeForMatch, VOICE_CRISIS_LINE } from "./safety";

/** Voice-only caption fallback after this many ms without a reply (Req 5.11). */
export const FALLBACK_MS = 15_000;
/** Late replies older than this are dropped (Req 5.13, Model_Router 60 s timeout). */
export const LATE_REPLY_LIMIT_MS = 60_000;
/** Echo window after speech ends (Req 20.31). */
export const ECHO_WINDOW_MS = 2_000;
/** Automatic recognizer restarts before giving up (Req 5.12). */
export const MAX_RECOGNIZER_RESTARTS = 3;

export const FALLBACK_CAPTION = "Sorry, I couldn't respond just now. Please try saying that again.";

export type CallPhase =
  | "checking"
  | "unsupported"
  | "requestingMic"
  | "micDenied"
  | "speaking"
  | "listening"
  | "thinking"
  | "recognitionFailed"
  | "ended";

export interface ReplyRequest {
  id: number;
  startedAt: number;
  /** Safety_Monitor flagged the transcript this request answers (Req 14.3). */
  flagged: boolean;
  /** The crisis line has already been spoken for this request. */
  crisisSpoken: boolean;
}

export interface CallState {
  phase: CallPhase;
  /** Orthogonal to `phase` (Req 5.7). */
  muted: boolean;
  /** Whether the adapter's recognizer is currently running per our effects. */
  recognizerActive: boolean;
  /** Consecutive automatic restarts since the last good recognizer result. */
  restarts: number;
  /** Text currently being spoken, if any. */
  speakingText: string | null;
  /** Texts waiting to be spoken after `speakingText`. */
  speechQueue: string[];
  lastSpokenText: string | null;
  lastSpeechEndAt: number | null;
  caption: string | null;
  nextRequestId: number;
  /** Request still inside its 15 s window. */
  pending: ReplyRequest | null;
  /** Request whose fallback caption was shown; still accepts a reply up to 60 s. */
  late: (ReplyRequest & { fallbackAt: number; speechAfterFallback: boolean }) | null;
  crisisVisible: boolean;
}

export type CallEvent =
  | { type: "init"; supported: boolean }
  | { type: "micGranted"; greeting: string }
  | { type: "micDenied" }
  | { type: "speechEnd"; at: number }
  | { type: "userSpeechStart"; at: number }
  | { type: "finalTranscript"; text: string; at: number }
  | { type: "recognizerStopped"; at: number }
  | { type: "fallbackTimeout"; requestId: number; at: number }
  | { type: "replyReceived"; requestId: number; text: string; at: number }
  | { type: "replyFailed"; requestId: number; at: number }
  | { type: "mute" }
  | { type: "unmute" }
  | { type: "end" };

export type CaptionKind = "companion" | "fallback" | "crisis";

export type CallEffect =
  | { type: "requestMic" }
  | { type: "startRecognizer" }
  | { type: "stopRecognizer" }
  | { type: "speak"; text: string }
  | { type: "cancelSpeech" }
  | { type: "showCaption"; text: string; kind: CaptionKind }
  | { type: "storeUserMessage"; text: string }
  | { type: "requestReply"; requestId: number; text: string; flagged: boolean }
  | { type: "storeCompanionMessage"; text: string }
  | { type: "startFallbackTimer"; requestId: number; ms: number }
  | { type: "cancelFallbackTimer"; requestId: number }
  | { type: "showCrisisResources" }
  | { type: "endCall" };

export interface CallResult {
  state: CallState;
  effects: CallEffect[];
}

export function initialCallState(): CallState {
  return {
    phase: "checking",
    muted: false,
    recognizerActive: false,
    restarts: 0,
    speakingText: null,
    speechQueue: [],
    lastSpokenText: null,
    lastSpeechEndAt: null,
    caption: null,
    nextRequestId: 1,
    pending: null,
    late: null,
    crisisVisible: false,
  };
}

/** Phases in which the call is live and Messages may still be stored. */
const ACTIVE: ReadonlySet<CallPhase> = new Set(["speaking", "listening", "thinking", "recognitionFailed"]);

export function isEcho(state: CallState, text: string, at: number): boolean {
  if (state.lastSpokenText === null || state.lastSpeechEndAt === null) return false;
  const dt = at - state.lastSpeechEndAt;
  if (dt < 0 || dt > ECHO_WINDOW_MS) return false;
  const heard = normalizeForMatch(text);
  return heard.length > 0 && heard === normalizeForMatch(state.lastSpokenText);
}

// ---- helpers (mutate the draft `s` and `fx` owned by one reduce call) ----

function startRec(s: CallState, fx: CallEffect[]): void {
  if (s.muted || s.recognizerActive) return;
  s.recognizerActive = true;
  fx.push({ type: "startRecognizer" });
}

function stopRec(s: CallState, fx: CallEffect[]): void {
  if (!s.recognizerActive) return;
  s.recognizerActive = false;
  fx.push({ type: "stopRecognizer" });
}

function caption(s: CallState, fx: CallEffect[], text: string, kind: CaptionKind): void {
  s.caption = text;
  fx.push({ type: "showCaption", text, kind });
}

/** Speak texts in order; recognizer is paused while speaking (Req 5.6). */
function speakAll(s: CallState, fx: CallEffect[], texts: string[]): void {
  if (texts.length === 0) return;
  if (s.phase === "speaking") {
    s.speechQueue = [...s.speechQueue, ...texts];
    return;
  }
  stopRec(s, fx);
  s.phase = "speaking";
  s.speakingText = texts[0];
  s.speechQueue = texts.slice(1);
  fx.push({ type: "speak", text: texts[0] });
}

function toListening(s: CallState, fx: CallEffect[]): void {
  s.phase = "listening";
  s.restarts = 0;
  startRec(s, fx);
}

function crisisPrefix(req: ReplyRequest): string[] {
  if (!req.flagged || req.crisisSpoken) return [];
  req.crisisSpoken = true;
  return [VOICE_CRISIS_LINE];
}

/** Shared path for the 15 s timeout and an early error (Req 5.11). */
function fallback(s: CallState, fx: CallEffect[], req: ReplyRequest, at: number, keepLate: boolean): void {
  fx.push({ type: "cancelFallbackTimer", requestId: req.id });
  s.pending = null;
  if (keepLate) s.late = { ...req, fallbackAt: at, speechAfterFallback: false };
  caption(s, fx, FALLBACK_CAPTION, "fallback");
  const prefix = crisisPrefix(keepLate && s.late ? s.late : req);
  if (prefix.length > 0) speakAll(s, fx, prefix);
  else toListening(s, fx);
}

export function reduceCall(state: CallState, event: CallEvent): CallResult {
  if (state.phase === "ended") return { state, effects: [] };

  const s: CallState = {
    ...state,
    speechQueue: [...state.speechQueue],
    pending: state.pending && { ...state.pending },
    late: state.late && { ...state.late },
  };
  const fx: CallEffect[] = [];

  switch (event.type) {
    case "init": {
      if (s.phase !== "checking") break;
      if (!event.supported) {
        s.phase = "unsupported"; // Req 5.9
      } else {
        s.phase = "requestingMic"; // Req 5.2
        fx.push({ type: "requestMic" });
      }
      break;
    }

    case "micDenied": {
      if (s.phase === "requestingMic") s.phase = "micDenied"; // Req 5.10
      break;
    }

    case "micGranted": {
      if (s.phase !== "requestingMic") break;
      // Req 5.3: caption, store, speak; recognizer starts after it finishes.
      caption(s, fx, event.greeting, "companion");
      fx.push({ type: "storeCompanionMessage", text: event.greeting });
      speakAll(s, fx, [event.greeting]);
      break;
    }

    case "speechEnd": {
      if (s.phase !== "speaking") break;
      s.lastSpokenText = s.speakingText;
      s.lastSpeechEndAt = event.at;
      const [next, ...rest] = s.speechQueue;
      if (next !== undefined) {
        s.speakingText = next;
        s.speechQueue = rest;
        fx.push({ type: "speak", text: next });
      } else {
        s.speakingText = null;
        toListening(s, fx); // Req 5.6: resume unless muted
      }
      break;
    }

    case "userSpeechStart": {
      if (s.phase !== "listening" || s.muted) break;
      s.restarts = 0;
      if (s.late && event.at >= s.late.fallbackAt) s.late.speechAfterFallback = true; // Req 5.14
      break;
    }

    case "finalTranscript": {
      if (s.phase !== "listening" || s.muted) break; // Req 5.7
      s.restarts = 0;
      if (event.text.trim().length === 0) break; // Req 5.4
      if (isEcho(s, event.text, event.at)) break; // Req 20.31
      if (s.late) s.late.speechAfterFallback = true;
      const id = s.nextRequestId;
      s.nextRequestId = id + 1;
      const { flagged } = detectCrisis(event.text);
      s.pending = { id, startedAt: event.at, flagged, crisisSpoken: false };
      fx.push({ type: "storeUserMessage", text: event.text });
      if (flagged) {
        s.crisisVisible = true;
        fx.push({ type: "showCrisisResources" }); // Req 14.2/14.3
      }
      fx.push({ type: "requestReply", requestId: id, text: event.text, flagged });
      fx.push({ type: "startFallbackTimer", requestId: id, ms: FALLBACK_MS });
      stopRec(s, fx);
      s.phase = "thinking";
      break;
    }

    case "recognizerStopped": {
      const wasActive = s.recognizerActive;
      s.recognizerActive = false;
      // Only unexpected stops while listening and unmuted count (Req 5.12).
      if (!wasActive || s.phase !== "listening" || s.muted) break;
      if (s.restarts < MAX_RECOGNIZER_RESTARTS) {
        s.restarts += 1;
        startRec(s, fx);
      } else {
        s.phase = "recognitionFailed";
      }
      break;
    }

    case "fallbackTimeout": {
      if (s.phase !== "thinking" || !s.pending || s.pending.id !== event.requestId) break;
      fallback(s, fx, s.pending, event.at, true);
      break;
    }

    case "replyFailed": {
      if (s.pending && s.pending.id === event.requestId) {
        fallback(s, fx, s.pending, event.at, false);
      } else if (s.late && s.late.id === event.requestId) {
        s.late = null;
      }
      break;
    }

    case "replyReceived": {
      if (!ACTIVE.has(s.phase)) break;
      const onTime = s.pending && s.pending.id === event.requestId ? s.pending : null;
      const late = !onTime && s.late && s.late.id === event.requestId ? s.late : null;
      const req = onTime ?? late;
      if (!req) break;
      if (late && event.at - late.startedAt > LATE_REPLY_LIMIT_MS) {
        s.late = null;
        break;
      }
      // Req 5.5 / 5.13: always store and caption.
      fx.push({ type: "storeCompanionMessage", text: event.text });
      caption(s, fx, event.text, "companion");
      if (onTime) {
        fx.push({ type: "cancelFallbackTimer", requestId: onTime.id });
        s.pending = null;
        speakAll(s, fx, [...crisisPrefix(onTime), event.text]); // Req 14.3
      } else if (late) {
        s.late = null;
        // Req 5.14: skip speaking if the user started talking after the fallback.
        const canSpeak = !late.speechAfterFallback && s.phase !== "recognitionFailed" && s.phase !== "thinking";
        if (canSpeak) speakAll(s, fx, [...crisisPrefix(late), event.text]);
      }
      break;
    }

    case "mute": {
      if (s.muted || !ACTIVE.has(s.phase)) break;
      s.muted = true;
      stopRec(s, fx); // stopped, not just ignored
      break;
    }

    case "unmute": {
      if (!s.muted) break;
      s.muted = false;
      if (s.phase === "listening") {
        s.restarts = 0;
        startRec(s, fx); // Req 5.7
      }
      break;
    }

    case "end": {
      // Req 5.8
      if (s.recognizerActive) fx.push({ type: "stopRecognizer" });
      if (s.phase === "speaking") fx.push({ type: "cancelSpeech" });
      if (s.pending) fx.push({ type: "cancelFallbackTimer", requestId: s.pending.id });
      fx.push({ type: "endCall" });
      s.phase = "ended";
      s.recognizerActive = false;
      s.speakingText = null;
      s.speechQueue = [];
      s.pending = null;
      s.late = null;
      break;
    }
  }

  return { state: s, effects: fx };
}

/** Fold a sequence of events; handy for tests and the adapter's replay. */
export function runCall(events: CallEvent[], start: CallState = initialCallState()): CallResult {
  let state = start;
  const effects: CallEffect[] = [];
  for (const e of events) {
    const r = reduceCall(state, e);
    state = r.state;
    effects.push(...r.effects);
  }
  return { state, effects };
}

"use client";

/**
 * Voice call controller (Req 5, 14.3, 20.3, 20.6, 20.17, 20.31).
 *
 * Drives the pure call machine (`reduceCall`) and executes its effects
 * against the speech adapter, Chat_Service, Activity_Tracker and
 * Tab_Coordinator. The React hook is a thin `useSyncExternalStore` view over
 * one `CallController` instance per mounted call page.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import {
  initialCallState,
  reduceCall,
  type CallEffect,
  type CallEvent,
  type CallPhase,
  type CallState,
  type CaptionKind,
} from "@/core/callMachine";
import type { Tone } from "@/core/models";
import type { ServiceResult } from "@/services/profileService";
import { setCallActive as setTrackerCallActive } from "@/services/activityTracker";
import {
  getOrCreateMainChat,
  getActiveCallChatId,
  requestReply,
  setCallActive as setChatCallActive,
  storeCompanionMessage,
  storeUserMessage,
} from "@/services/chatService";
import { markCheckInCompleted } from "@/services/checkInCompletion";
import { onChatEnded } from "@/services/memoryService";
import { completeReminder } from "@/services/reminderService";
import { getActiveProfileId, subscribeSession } from "@/services/session";
import { acquireCallLock } from "@/services/tabCoordinator";
import {
  createRecognizer,
  createSynthesizer,
  primeSpeech,
  requestMicrophone,
  speechSupported,
  type Recognizer,
  type Synthesizer,
} from "./speech";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CallSnapshot {
  /** Machine phase. `checking` before the user starts the call. */
  phase: CallPhase;
  /** The user pressed start (lock, mic and chat setup may still be running). */
  started: boolean;
  /** Setup in progress (lock, mic prompt, chat creation). */
  starting: boolean;
  muted: boolean;
  /** Latest caption (greeting, reply, or fallback); stays until replaced (5.5). */
  caption: string | null;
  captionKind: CaptionKind | null;
  /** Live interim transcript of the user's speech. */
  interim: string;
  /** Elapsed call time, updated every second (5.1). */
  elapsedMs: number;
  /** Chat holding the call transcript, once created. */
  chatId: string | null;
  /** Speech_Recognizer support; null until detected on the client. */
  supported: boolean | null;
  /** The call lock is held by another tab (20.3). */
  blockedElsewhere: boolean;
  /** Setup error (e.g. the Chat could not be created). */
  error: string | null;
  /** Crisis language was detected during this call (14.3). */
  crisis: boolean;
}

export interface CallDeps {
  profileId: string;
  displayName: string;
  botName: string;
  tone: Tone;
  showCrisis: () => void;
  checkStorage: () => Promise<void>;
  /** The Reminder this call answers, if any (24.7). */
  reminder?: { id: string; text: string } | null;
}

// ---------------------------------------------------------------------------
// Greeting
// ---------------------------------------------------------------------------

/** One Companion greeting per call (5.3), phrased for the Profile's Tone. */
export function callGreeting(displayName: string, botName: string, tone: Tone): string {
  const name = displayName.trim();
  switch (tone) {
    case "cheerful":
      return `Hi ${name}! It's ${botName}. It's really nice to hear from you. How's your day going?`;
    case "playful":
      return `Hey ${name}, ${botName} here. So, what's the latest with you today?`;
    case "calm":
    default:
      return `Hello ${name}, it's ${botName}. How are you doing today?`;
  }
}

/** Greeting for a call that answers a Reminder (24.7), phrased for the Tone. */
export function reminderGreeting(displayName: string, botName: string, tone: Tone, text: string): string {
  const name = displayName.trim();
  const what = text.trim().replace(/[.!?]+$/, "");
  switch (tone) {
    case "cheerful":
      return `Hi ${name}! It's ${botName}. Just calling to remind you: ${what}. Have fun!`;
    case "playful":
      return `Hey ${name}, ${botName} here with your reminder: ${what}. Don't say I didn't tell you!`;
    case "calm":
    default:
      return `Hey ${name}, it's ${botName}. Just calling to remind you: ${what}.`;
  }
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

const INITIAL_SNAPSHOT: CallSnapshot = {
  phase: "checking",
  started: false,
  starting: false,
  muted: false,
  caption: null,
  captionKind: null,
  interim: "",
  elapsedMs: 0,
  chatId: null,
  supported: null,
  blockedElsewhere: false,
  error: null,
  crisis: false,
};

const START_FAILED = "The call could not be started. Please try again.";

type UserStore = Promise<ServiceResult<{ message: { id: string } }> | null>;

/** Resources of one started call. */
interface Session {
  profileId: string;
  /** Groups this call's Messages in the shared Chat. */
  callId: string;
  chatId: string | null;
  release: (() => void) | null;
  recognizer: Recognizer | null;
  synth: Synthesizer | null;
  timers: Map<number, ReturnType<typeof setTimeout>>;
  aborts: Set<AbortController>;
  /** Serializes greeting and transcript writes so they stay in order. */
  storeChain: Promise<unknown>;
  lastUserStore: UserStore;
  startedAt: number | null;
  ticker: ReturnType<typeof setInterval> | null;
  finalizing: Promise<void> | null;
}

/** The controller of the call running in this tab, if any (for Profile switching, 20.6). */
const liveControllers = new Set<CallController>();

/**
 * Ends the call running in this tab, if any, and resolves once its transcript
 * writes have settled. Callers that switch the Active_Profile await this
 * first so the transcript is saved to the Profile that started the call (20.6).
 */
export async function endActiveCall(): Promise<void> {
  await Promise.all([...liveControllers].map((c) => c.end()));
}

class CallController {
  private machine: CallState = initialCallState();
  private snap: CallSnapshot = INITIAL_SNAPSHOT;
  private readonly listeners = new Set<() => void>();
  private readonly queue: CallEvent[] = [];
  private dispatching = false;
  private session: Session | null = null;
  deps: CallDeps;

  constructor(deps: CallDeps) {
    this.deps = deps;
  }

  // ---- store plumbing ----

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => void this.listeners.delete(cb);
  };

  getSnapshot = (): CallSnapshot => this.snap;

  private set(patch: Partial<CallSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    for (const l of [...this.listeners]) l();
  }

  // ---- machine driver ----

  /** Queues events so effects that dispatch synchronously run in order. */
  private dispatch(event: CallEvent): void {
    this.queue.push(event);
    if (this.dispatching) return;
    this.dispatching = true;
    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift()!;
        const { state, effects } = reduceCall(this.machine, next);
        this.machine = state;
        this.set({ phase: state.phase, muted: state.muted });
        // Replies are stored by Chat_Service before they reach the machine.
        const replyAlreadyStored = next.type === "replyReceived";
        for (const fx of effects) this.run(fx, replyAlreadyStored);
      }
    } finally {
      this.dispatching = false;
    }
  }

  private run(fx: CallEffect, replyAlreadyStored: boolean): void {
    const s = this.session;
    switch (fx.type) {
      case "requestMic":
        void this.requestMic();
        return;
      case "startRecognizer":
        s?.recognizer?.start();
        return;
      case "stopRecognizer":
        s?.recognizer?.stop();
        return;
      case "speak":
        if (!s?.synth) {
          queueMicrotask(() => this.dispatch({ type: "speechEnd", at: Date.now() }));
          return;
        }
        s.synth.speak(fx.text, () => {
          if (this.session === s) this.dispatch({ type: "speechEnd", at: Date.now() });
        });
        return;
      case "cancelSpeech":
        s?.synth?.cancel();
        return;
      case "showCaption":
        this.set({ caption: fx.text, captionKind: fx.kind });
        return;
      case "storeUserMessage":
        if (!s?.chatId) return;
        s.lastUserStore = this.enqueueStore(s, () => storeUserMessage(s.chatId!, fx.text, { channel: "voice", callId: s.callId }));
        return;
      case "requestReply":
        if (s) void this.requestReply(s, fx.requestId);
        return;
      case "storeCompanionMessage":
        if (replyAlreadyStored || !s?.chatId) return;
        void this.enqueueStore(s, () => storeCompanionMessage(s.chatId!, fx.text, { channel: "voice", callId: s.callId }));
        return;
      case "startFallbackTimer": {
        if (!s) return;
        const prev = s.timers.get(fx.requestId);
        if (prev) clearTimeout(prev);
        s.timers.set(
          fx.requestId,
          setTimeout(() => {
            s.timers.delete(fx.requestId);
            if (this.session === s) this.dispatch({ type: "fallbackTimeout", requestId: fx.requestId, at: Date.now() });
          }, fx.ms),
        );
        return;
      }
      case "cancelFallbackTimer": {
        const t = s?.timers.get(fx.requestId);
        if (t) clearTimeout(t);
        s?.timers.delete(fx.requestId);
        return;
      }
      case "showCrisisResources":
        this.set({ crisis: true });
        this.deps.showCrisis();
        return;
      case "endCall":
        void this.finalize();
        return;
    }
  }

  private enqueueStore<T>(s: Session, write: () => Promise<T>): Promise<T | null> {
    const p = s.storeChain.then(write).catch(() => null);
    s.storeChain = p;
    return p;
  }

  // ---- effect implementations ----

  private async requestMic(): Promise<void> {
    const s = this.session;
    if (!s) return;
    const granted = await requestMicrophone();
    if (this.session !== s || this.machine.phase !== "requestingMic") return;
    if (!granted) {
      this.dispatch({ type: "micDenied" }); // 5.10
      this.set({ starting: false });
      void this.finalize();
      return;
    }

    const chat = await getOrCreateMainChat(s.profileId).catch(() => null);
    if (this.session !== s || this.machine.phase !== "requestingMic") return;
    if (!chat || !chat.ok) {
      this.set({ starting: false, error: chat && !chat.ok ? chat.error : START_FAILED });
      this.dispatch({ type: "end" });
      return;
    }

    s.chatId = chat.value.id;
    setChatCallActive(s.chatId); // 20.9
    setTrackerCallActive(true); // 15.6
    void markCheckInCompleted(s.profileId); // 12.9

    s.recognizer = createRecognizer({
      onSpeechStart: () => {
        if (this.session === s) this.dispatch({ type: "userSpeechStart", at: Date.now() });
      },
      onInterim: (text) => {
        if (this.session === s && this.snap.interim !== text) this.set({ interim: text });
      },
      onFinal: (text) => {
        if (this.session === s) this.dispatch({ type: "finalTranscript", text, at: Date.now() });
      },
      onStopped: () => {
        if (this.session === s) this.dispatch({ type: "recognizerStopped", at: Date.now() });
      },
    });

    s.startedAt = Date.now();
    s.ticker = setInterval(() => {
      if (this.session !== s || s.startedAt === null) return;
      const elapsed = Date.now() - s.startedAt;
      if (Math.floor(elapsed / 1000) !== Math.floor(this.snap.elapsedMs / 1000)) this.set({ elapsedMs: elapsed });
    }, 250);

    this.set({ starting: false, chatId: s.chatId, elapsedMs: 0 });
    const { displayName, botName, tone, reminder } = this.deps;
    if (reminder) void completeReminder(reminder.id).catch(() => undefined); // 24.7
    const greeting = reminder
      ? reminderGreeting(displayName, botName, tone, reminder.text)
      : callGreeting(displayName, botName, tone);
    this.dispatch({ type: "micGranted", greeting }); // 5.3
  }

  private async requestReply(s: Session, requestId: number): Promise<void> {
    const stored = s.lastUserStore;
    const ac = new AbortController();
    s.aborts.add(ac);
    // The machine speaks an in-character line; busy/quota gets its own wording.
    const failed = (busy = false) => {
      if (this.session === s) this.dispatch({ type: "replyFailed", requestId, at: Date.now(), busy });
    };
    try {
      const res = await stored;
      if (this.session !== s) return;
      if (!res || !res.ok || !s.chatId) return failed(); // 5.11: transcript kept, caption fallback
      const reply = await requestReply(s.chatId, res.value.message.id, { signal: ac.signal });
      if (this.session !== s || ac.signal.aborted) return;
      // A crisis fallback reply (14.8) also arrives as `reply` and is spoken.
      if (reply.reply && !reply.discarded) {
        this.dispatch({ type: "replyReceived", requestId, text: reply.reply.content, at: Date.now() });
      } else {
        failed(reply.error?.providerError?.kind === "busy");
      }
    } catch {
      failed();
    } finally {
      s.aborts.delete(ac);
    }
  }

  /** Releases everything the call holds; idempotent (5.8, 20.6). */
  private finalize(): Promise<void> {
    const s = this.session;
    if (!s) return Promise.resolve();
    if (s.finalizing) return s.finalizing;
    s.finalizing = (async () => {
      if (s.ticker !== null) clearInterval(s.ticker);
      s.ticker = null;
      if (s.startedAt !== null) this.set({ elapsedMs: Date.now() - s.startedAt });
      s.recognizer?.dispose();
      s.synth?.dispose();
      for (const t of s.timers.values()) clearTimeout(t);
      s.timers.clear();
      for (const ac of s.aborts) ac.abort();
      this.set({ interim: "" });

      // Every Message stored during the call is in the Chat once these settle (5.8).
      await s.storeChain.catch(() => undefined);

      if (s.chatId) {
        if (getActiveCallChatId() === s.chatId) setChatCallActive(null);
        setTrackerCallActive(false);
      }
      s.release?.();
      s.release = null;
      if (this.machine.phase === "ended") liveControllers.delete(this);
      if (s.chatId) {
        onChatEnded(s.profileId); // 9.5
        void this.deps.checkStorage().catch(() => undefined); // 20.20
      }
    })();
    return s.finalizing;
  }

  // ---- actions ----

  /** Client-only feature detection (5.9). */
  detect(): void {
    const supported = speechSupported();
    this.set({ supported });
    if (!supported && this.machine.phase === "checking") this.dispatch({ type: "init", supported: false });
  }

  async start(): Promise<void> {
    if (this.snap.started || this.snap.starting || this.machine.phase !== "checking") return;
    if (!speechSupported()) {
      this.detect();
      return;
    }
    primeSpeech(); // still inside the click
    const synth = createSynthesizer(); // starts loading voices now
    this.set({ starting: true, error: null, blockedElsewhere: false });

    const profileId = this.deps.profileId;
    const release = await acquireCallLock(); // 20.3
    if (!release) {
      synth.dispose();
      this.set({ starting: false, blockedElsewhere: true });
      return;
    }
    if (this.deps.profileId !== profileId || getActiveProfileId() !== profileId) {
      release();
      synth.dispose();
      this.set({ starting: false });
      return;
    }

    this.session = {
      profileId,
      callId: crypto.randomUUID(),
      chatId: null,
      release,
      recognizer: null,
      synth,
      timers: new Map(),
      aborts: new Set(),
      storeChain: Promise.resolve(),
      lastUserStore: Promise.resolve(null),
      startedAt: null,
      ticker: null,
      finalizing: null,
    };
    liveControllers.add(this);
    this.set({ started: true });
    this.dispatch({ type: "init", supported: true }); // → requestMic (5.2)
  }

  toggleMute(): void {
    this.dispatch({ type: this.machine.muted ? "unmute" : "mute" }); // 5.7
  }

  /** Ends the call (5.8). Resolves once the transcript writes have settled. */
  end(): Promise<void> {
    if (!this.session) return Promise.resolve();
    if (this.machine.phase !== "ended") this.dispatch({ type: "end" });
    return this.finalize();
  }

  /** Back to the pre-call screen (after an ended call, denied mic, or blocked start). */
  async reset(): Promise<void> {
    await this.end();
    liveControllers.delete(this);
    this.session = null;
    this.machine = initialCallState();
    this.snap = { ...INITIAL_SNAPSHOT, supported: this.snap.supported };
    for (const l of [...this.listeners]) l();
    this.detect();
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

const subscribeOnline = (cb: () => void) => {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
};
const getOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
const getServerOffline = () => false;

export interface CallControllerApi extends CallSnapshot {
  /** The browser reports it is offline (20.17). */
  offline: boolean;
  start: () => void;
  toggleMute: () => void;
  end: () => Promise<void>;
  reset: () => void;
}

/**
 * Voice call state and actions for the call page. Ends the call (saving the
 * transcript) on unmount, page hide, and Active_Profile change (20.6).
 */
export function useCallController(deps: CallDeps): CallControllerApi {
  const [controller] = useState(() => new CallController(deps));
  const snap = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const offline = useSyncExternalStore(subscribeOnline, getOffline, getServerOffline);

  // Latest deps for greeting text and callbacks.
  useEffect(() => {
    controller.deps = deps;
  });

  useEffect(() => {
    controller.detect();
  }, [controller]);

  // End the call when the Active_Profile changes away from the caller (20.6).
  const profileId = deps.profileId;
  useEffect(() => {
    const check = () => {
      const active = getActiveProfileId();
      if (controller.getSnapshot().started && active !== profileId) void controller.end();
    };
    check();
    return subscribeSession(check);
  }, [controller, profileId]);

  // Closing or leaving the page ends the call.
  useEffect(() => {
    const onHide = () => void controller.end();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void controller.end();
    };
  }, [controller]);

  const start = useCallback(() => void controller.start(), [controller]);
  const toggleMute = useCallback(() => controller.toggleMute(), [controller]);
  const end = useCallback(() => controller.end(), [controller]);
  const reset = useCallback(() => void controller.reset(), [controller]);

  return { ...snap, offline, start, toggleMute, end, reset };
}

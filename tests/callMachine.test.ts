import { describe, expect, it } from "vitest";
import {
  FALLBACK_CAPTION,
  FALLBACK_MS,
  initialCallState,
  reduceCall,
  runCall,
  type CallEvent,
  type CallState,
} from "@/core/callMachine";
import { VOICE_CRISIS_LINE } from "@/core/safety";

const GREETING = "Hi there, how was your day?";

/** Call that has greeted and finished speaking at t=1000 → listening. */
const listeningCall = (): CallState =>
  runCall([
    { type: "init", supported: true },
    { type: "micGranted", greeting: GREETING },
    { type: "speechEnd", at: 1_000 },
  ]).state;

const step = (state: CallState, ...events: CallEvent[]) => runCall(events, state);

describe("callMachine start-up", () => {
  it("goes to unsupported without SpeechRecognition", () => {
    const r = reduceCall(initialCallState(), { type: "init", supported: false });
    expect(r.state.phase).toBe("unsupported");
    expect(r.effects).toEqual([]);
  });

  it("requests the mic before starting recognition, then greets", () => {
    const r = runCall([
      { type: "init", supported: true },
      { type: "micGranted", greeting: GREETING },
    ]);
    expect(r.effects.map((e) => e.type)).toEqual(["requestMic", "showCaption", "storeCompanionMessage", "speak"]);
    expect(r.state.phase).toBe("speaking");
    expect(r.state.recognizerActive).toBe(false);

    const after = step(r.state, { type: "speechEnd", at: 1_000 });
    expect(after.state.phase).toBe("listening");
    expect(after.effects).toEqual([{ type: "startRecognizer" }]);
  });

  it("goes to micDenied and never starts the recognizer", () => {
    const r = runCall([{ type: "init", supported: true }, { type: "micDenied" }]);
    expect(r.state.phase).toBe("micDenied");
    expect(r.effects.some((e) => e.type === "startRecognizer")).toBe(false);
  });
});

describe("callMachine transcripts", () => {
  it("discards whitespace-only transcripts", () => {
    const r = step(listeningCall(), { type: "finalTranscript", text: "   ", at: 5_000 });
    expect(r.effects).toEqual([]);
    expect(r.state.phase).toBe("listening");
  });

  it("discards echo of the last spoken text within 2 s, accepts it after", () => {
    const echo = step(listeningCall(), { type: "finalTranscript", text: "hi there... How was your DAY", at: 2_500 });
    expect(echo.effects).toEqual([]);

    const later = step(listeningCall(), { type: "finalTranscript", text: "hi there how was your day", at: 3_500 });
    expect(later.effects.map((e) => e.type)).toContain("storeUserMessage");
  });

  it("stores, requests a reply, and speaks the reply", () => {
    const sent = step(listeningCall(), { type: "finalTranscript", text: "Pretty good", at: 5_000 });
    expect(sent.state.phase).toBe("thinking");
    expect(sent.effects).toEqual([
      { type: "storeUserMessage", text: "Pretty good" },
      { type: "requestReply", requestId: 1, text: "Pretty good", flagged: false },
      { type: "startFallbackTimer", requestId: 1, ms: FALLBACK_MS },
      { type: "stopRecognizer" },
    ]);

    const replied = step(sent.state, { type: "replyReceived", requestId: 1, text: "Glad to hear!", at: 7_000 });
    expect(replied.state.phase).toBe("speaking");
    expect(replied.effects).toContainEqual({ type: "storeCompanionMessage", text: "Glad to hear!" });
    expect(replied.effects).toContainEqual({ type: "speak", text: "Glad to hear!" });
    expect(replied.state.caption).toBe("Glad to hear!");
  });

  it("speaks the crisis line before the reply when flagged", () => {
    const sent = step(listeningCall(), { type: "finalTranscript", text: "I want to die", at: 5_000 });
    expect(sent.effects).toContainEqual({ type: "showCrisisResources" });
    const replied = step(sent.state, { type: "replyReceived", requestId: 1, text: "I'm here.", at: 6_000 });
    expect(replied.effects).toContainEqual({ type: "speak", text: VOICE_CRISIS_LINE });
    expect(replied.state.speechQueue).toEqual(["I'm here."]);

    const next = step(replied.state, { type: "speechEnd", at: 9_000 });
    expect(next.effects).toEqual([{ type: "speak", text: "I'm here." }]);
  });
});

describe("callMachine fallback and late replies", () => {
  const timedOut = () =>
    step(
      listeningCall(),
      { type: "finalTranscript", text: "Tell me a story", at: 5_000 },
      { type: "fallbackTimeout", requestId: 1, at: 20_000 },
      { type: "speechEnd", at: 21_000 }, // the in-character fallback line is spoken first
    );

  it("speaks the fallback line and resumes listening at 15 s", () => {
    const r = timedOut();
    expect(r.state.phase).toBe("listening");
    expect(r.state.caption).toBe(FALLBACK_CAPTION);
    expect(r.state.recognizerActive).toBe(true);
  });

  it("speaks a late reply when the user has not spoken since the fallback", () => {
    const r = step(timedOut().state, { type: "replyReceived", requestId: 1, text: "Once upon a time", at: 30_000 });
    expect(r.effects).toContainEqual({ type: "storeCompanionMessage", text: "Once upon a time" });
    expect(r.effects).toContainEqual({ type: "speak", text: "Once upon a time" });
  });

  it("stores and captions but does not speak a late reply after user speech", () => {
    const r = step(
      timedOut().state,
      { type: "userSpeechStart", at: 22_000 },
      { type: "replyReceived", requestId: 1, text: "Once upon a time", at: 30_000 },
    );
    expect(r.effects).toContainEqual({ type: "storeCompanionMessage", text: "Once upon a time" });
    expect(r.effects.some((e) => e.type === "speak")).toBe(false);
    expect(r.state.caption).toBe("Once upon a time");
    expect(r.state.phase).toBe("listening");
  });

  it("drops replies older than 60 s", () => {
    const r = step(timedOut().state, { type: "replyReceived", requestId: 1, text: "late", at: 70_000 });
    expect(r.effects).toEqual([]);
  });
});

describe("callMachine recognizer, mute, end", () => {
  it("restarts up to 3 times then fails", () => {
    const stop: CallEvent = { type: "recognizerStopped", at: 2_000 };
    const r = step(listeningCall(), stop, stop, stop);
    expect(r.effects.filter((e) => e.type === "startRecognizer")).toHaveLength(3);
    expect(r.state.phase).toBe("listening");
    expect(step(r.state, stop).state.phase).toBe("recognitionFailed");
  });

  it("stops the recognizer while muted and ignores speech", () => {
    const muted = step(listeningCall(), { type: "mute" });
    expect(muted.effects).toEqual([{ type: "stopRecognizer" }]);
    const heard = step(muted.state, { type: "finalTranscript", text: "secret", at: 9_000 });
    expect(heard.effects).toEqual([]);
    expect(step(heard.state, { type: "unmute" }).effects).toEqual([{ type: "startRecognizer" }]);
  });

  it("end cancels speech and ignores later events", () => {
    const speaking = runCall([
      { type: "init", supported: true },
      { type: "micGranted", greeting: GREETING },
    ]).state;
    const ended = step(speaking, { type: "end" });
    expect(ended.effects).toEqual([{ type: "cancelSpeech" }, { type: "endCall" }]);
    expect(ended.state.phase).toBe("ended");
    expect(step(ended.state, { type: "speechEnd", at: 5 }).effects).toEqual([]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationRequest } from "@/core/generation";
import { clientIp, createRateLimiter } from "@/server/rateLimiter";
import { safeLog } from "@/server/safeLog";
import { GenerateRequestSchema, issueFields } from "@/server/schema";
import {
  DEFAULT_GEMINI_MODEL,
  SYNTHETIC_START,
  callGemini,
  geminiModel,
  toGeminiBody,
} from "@/server/gemini";

const KEY = "AIzaSy-TEST-SECRET-KEY-123456";

function req(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    task: "reply",
    system: "sys",
    messages: [{ role: "user", content: "hi" }],
    ...overrides,
  };
}

describe("rateLimiter", () => {
  it("allows 20 per 60 s per IP then denies with Retry-After", () => {
    let t = 1_000_000;
    const rl = createRateLimiter({ now: () => t });
    for (let i = 0; i < 20; i++) {
      expect(rl.check("1.1.1.1").allowed).toBe(true);
      t += 1000;
    }
    const denied = rl.check("1.1.1.1");
    expect(denied.allowed).toBe(false);
    // oldest hit at 1_000_000, now 1_020_000 → 40 s remaining
    expect(denied.retryAfterS).toBe(40);
    expect(rl.check("2.2.2.2").allowed).toBe(true);
    t = 1_000_000 + 60_000; // oldest hit falls out of the window
    expect(rl.check("1.1.1.1").allowed).toBe(true);
  });

  it("prunes stale IPs and enforces a key cap", () => {
    let t = 0;
    const rl = createRateLimiter({ now: () => t, maxKeys: 5 });
    for (let i = 0; i < 5; i++) rl.check(`10.0.0.${i}`);
    expect(rl.size()).toBe(5);
    rl.check("10.0.0.99");
    expect(rl.size()).toBeLessThanOrEqual(5);
    t = 120_000;
    rl.check("x");
    expect(rl.size()).toBe(1);
  });

  it("clientIp picks first x-forwarded-for, then x-real-ip, then unknown", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": " 9.9.9.9 , 8.8.8.8" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers({ "x-real-ip": "7.7.7.7" }))).toBe("7.7.7.7");
    expect(clientIp(new Headers())).toBe("unknown");
  });
});

describe("safeLog", () => {
  afterEach(() => vi.restoreAllMocks());

  it("emits only route, status, code, task, ms", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});
    safeLog({
      route: "/api/generate",
      status: 200,
      code: "ok",
      task: "reply",
      ms: 12,
      // extra runtime fields must be dropped
      ...({ body: "secret content", apiKey: KEY } as object),
    } as Parameters<typeof safeLog>[0]);
    expect(spy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(spy.mock.calls[0][0] as string);
    expect(Object.keys(parsed).sort()).toEqual(["code", "ms", "route", "status", "task"]);
    expect(spy.mock.calls[0][0]).not.toContain(KEY);
  });
});

describe("GenerateRequestSchema", () => {
  it("accepts a valid body", () => {
    expect(GenerateRequestSchema.safeParse(req()).success).toBe(true);
  });

  it("rejects bad task, lengths, roles, and unknown fields", () => {
    const bad = [
      { ...req(), task: "other" },
      { ...req(), system: "" },
      { ...req(), system: "a".repeat(20_001) },
      { ...req(), messages: [] },
      { ...req(), messages: Array.from({ length: 21 }, () => ({ role: "user", content: "x" })) },
      { ...req(), messages: [{ role: "system", content: "x" }] },
      { ...req(), messages: [{ role: "user", content: "a".repeat(10_001) }] },
      { ...req(), messages: [{ role: "user", content: "x", extra: 1 }] },
      { ...req(), extra: true },
    ];
    for (const b of bad) expect(GenerateRequestSchema.safeParse(b).success).toBe(false);
  });

  it("issueFields names failing fields including unknown keys", () => {
    const r = GenerateRequestSchema.safeParse({ ...req(), task: "nope", foo: 1 });
    expect(r.success).toBe(false);
    if (!r.success) expect(issueFields(r.error).sort()).toEqual(["foo", "task"]);
  });
});

describe("gemini helpers", () => {
  it("geminiModel defaults when unset or blank", () => {
    expect(geminiModel({})).toBe(DEFAULT_GEMINI_MODEL);
    expect(geminiModel({ GEMINI_MODEL: "  " })).toBe("gemini-flash-latest");
    expect(geminiModel({ GEMINI_MODEL: "gemini-x" })).toBe("gemini-x");
  });

  it("toGeminiBody maps roles, merges turns, adds synthetic start", () => {
    const body = toGeminiBody(
      req({
        messages: [
          { role: "companion", content: "hello" },
          { role: "companion", content: "there" },
          { role: "user", content: "a" },
          { role: "user", content: "b" },
        ],
      }),
    );
    expect(body.systemInstruction).toEqual({ parts: [{ text: "sys" }] });
    expect(body.contents).toEqual([
      { role: "user", parts: [{ text: SYNTHETIC_START }] },
      { role: "model", parts: [{ text: "hello\n\nthere" }] },
      { role: "user", parts: [{ text: "a\n\nb" }] },
    ]);
    expect(body.generationConfig).toBeUndefined();
    expect(toGeminiBody(req({ task: "extract_memories" })).generationConfig).toEqual({
      responseMimeType: "application/json",
    });
  });

  function fakeFetch(res: Response | Error) {
    return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
      void _url;
      void _init;
      if (res instanceof Error) throw res;
      return res;
    });
  }

  it("callGemini sends key only in header and extracts text", async () => {
    const f = fakeFetch(
      new Response(
        JSON.stringify({ candidates: [{ content: { parts: [{ text: "Hi " }, { text: "there" }] } }] }),
        { status: 200 },
      ),
    );
    const r = await callGemini({ apiKey: KEY, model: "gemini-flash-latest", req: req(), fetch: f as typeof fetch });
    expect(r).toEqual({ ok: true, text: "Hi there" });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent",
    );
    expect(String(url)).not.toContain(KEY);
    expect((init?.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    expect(String(init?.body)).not.toContain(KEY);
  });

  it("callGemini classifies quota, upstream, and timeout without leaking", async () => {
    const q429 = await callGemini({ apiKey: KEY, model: "m", req: req(), fetch: fakeFetch(new Response("", { status: 429 })) as typeof fetch });
    expect(q429).toEqual({ ok: false, kind: "quota", status: 429 });

    const exhausted = await callGemini({
      apiKey: KEY,
      model: "m",
      req: req(),
      fetch: fakeFetch(new Response(`{"error":{"status":"RESOURCE_EXHAUSTED","key":"${KEY}"}}`, { status: 403 })) as typeof fetch,
    });
    expect(exhausted).toEqual({ ok: false, kind: "quota", status: 403 });
    expect(JSON.stringify(exhausted)).not.toContain(KEY);

    const up = await callGemini({ apiKey: KEY, model: "m", req: req(), fetch: fakeFetch(new Response("boom", { status: 500 })) as typeof fetch });
    expect(up).toEqual({ ok: false, kind: "upstream", status: 500 });

    const empty = await callGemini({ apiKey: KEY, model: "m", req: req(), fetch: fakeFetch(new Response("{}", { status: 200 })) as typeof fetch });
    expect(empty.ok).toBe(false);

    const abortErr = new DOMException("aborted", "AbortError");
    const to = await callGemini({ apiKey: KEY, model: "m", req: req(), fetch: fakeFetch(abortErr) as typeof fetch });
    expect(to).toEqual({ ok: false, kind: "timeout" });

    const net = await callGemini({ apiKey: KEY, model: "m", req: req(), fetch: fakeFetch(new TypeError("fail")) as typeof fetch });
    expect(net).toEqual({ ok: false, kind: "upstream" });
  });
});

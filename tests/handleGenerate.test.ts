import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleGenerate, MAX_BODY_BYTES, type GenerateDeps } from "@/server/handleGenerate";
import { createRateLimiter } from "@/server/rateLimiter";
import * as generateRoute from "@/app/api/generate/route";
import * as statusRoute from "@/app/api/provider-status/route";
import { handleProviderStatus } from "@/server/providerStatus";

const KEY = "AIzaSy-TEST-SECRET-KEY-123456";
const URL_ = "http://localhost/api/generate";
const VALID = { task: "reply", system: "sys", messages: [{ role: "user", content: "hi" }] };

function okFetch(text = "hello"): typeof fetch {
  return vi.fn(async () =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
  ) as unknown as typeof fetch;
}

const fakeUser = async () => ({ ok: true as const, user: { id: "test-user" } });

function deps(over: Partial<GenerateDeps> = {}): GenerateDeps {
  return {
    env: { GEMINI_API_KEY: KEY },
    fetch: okFetch(),
    now: () => 0,
    limiter: createRateLimiter(),
    requireUser: fakeUser,
    ...over,
  };
}

function post(body: string, headers: Record<string, string> = {}): Request {
  return new Request(URL_, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body,
  });
}

async function readAll(res: Response) {
  const text = await res.text();
  return { text, body: JSON.parse(text) as Record<string, unknown> };
}

let logSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  logSpy = vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  vi.unstubAllEnvs();
});

function expectNoKeyLeak(res: Response, text: string) {
  expect(text).not.toContain(KEY);
  for (const [, v] of res.headers) expect(v).not.toContain(KEY);
  for (const call of logSpy.mock.calls) expect(String(call[0])).not.toContain(KEY);
}

describe("handleGenerate", () => {
  it("returns 200 {text} with no-store for a valid request", async () => {
    const d = deps();
    const res = await handleGenerate(post(JSON.stringify(VALID)), d);
    const { text, body } = await readAll(res);
    expect(res.status).toBe(200);
    expect(body).toEqual({ text: "hello" });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(d.fetch).toHaveBeenCalledTimes(1);
    expectNoKeyLeak(res, text);
    expect(JSON.parse(String(logSpy.mock.calls[0][0]))).toEqual({
      route: "/api/generate",
      status: 200,
      task: "reply",
      ms: 0,
    });
  });

  it("415 for non-JSON content type", async () => {
    const d = deps();
    const res = await handleGenerate(post("{}", { "content-type": "text/plain" }), d);
    expect(res.status).toBe(415);
    expect((await readAll(res)).body).toMatchObject({ error: { code: "unsupported_media_type" } });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("503 when GEMINI_API_KEY is empty", async () => {
    const d = deps({ env: { GEMINI_API_KEY: "  " } });
    const res = await handleGenerate(post(JSON.stringify(VALID)), d);
    expect(res.status).toBe(503);
    expect((await readAll(res)).body).toMatchObject({ error: { code: "gemini_not_configured" } });
  });

  it("429 rate_limited_local with Retry-After after 20 requests", async () => {
    const d = deps();
    for (let i = 0; i < 20; i++) {
      expect((await handleGenerate(post(JSON.stringify(VALID)), d)).status).toBe(200);
    }
    const res = await handleGenerate(post(JSON.stringify(VALID)), d);
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await readAll(res)).body).toMatchObject({ error: { code: "rate_limited_local" } });
    expect(d.fetch).toHaveBeenCalledTimes(20);
  });

  it("413 by declared Content-Length and by streamed size", async () => {
    const d = deps();
    const r1 = await handleGenerate(
      post("{}", { "content-length": String(MAX_BODY_BYTES + 1) }),
      d,
    );
    expect(r1.status).toBe(413);
    const big = JSON.stringify({ ...VALID, system: "x".repeat(MAX_BODY_BYTES) });
    const r2 = await handleGenerate(post(big), d);
    expect(r2.status).toBe(413);
    expect((await readAll(r2)).body).toMatchObject({ error: { code: "payload_too_large" } });
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("400 invalid_json and invalid_request with fields", async () => {
    const d = deps();
    const r1 = await handleGenerate(post("{not json"), d);
    expect(r1.status).toBe(400);
    expect((await readAll(r1)).body).toMatchObject({ error: { code: "invalid_json" } });

    const r2 = await handleGenerate(post(JSON.stringify({ ...VALID, task: "nope", extra: 1 })), d);
    expect(r2.status).toBe(400);
    const { body } = await readAll(r2);
    const err = body.error as { code: string; fields: string[] };
    expect(err.code).toBe("invalid_request");
    expect(err.fields).toEqual(expect.arrayContaining(["task", "extra"]));
    expect(d.fetch).not.toHaveBeenCalled();
  });

  it("maps upstream quota → 429, other error → 502, timeout → 504", async () => {
    const quota = deps({
      fetch: (async () => new Response("RESOURCE_EXHAUSTED " + KEY, { status: 403 })) as typeof fetch,
    });
    const r1 = await handleGenerate(post(JSON.stringify(VALID)), quota);
    const t1 = await readAll(r1);
    expect(r1.status).toBe(429);
    expect(t1.body).toMatchObject({ error: { code: "gemini_quota" } });
    expectNoKeyLeak(r1, t1.text);

    const bad = deps({
      fetch: (async () => new Response("boom " + KEY, { status: 500 })) as typeof fetch,
    });
    const r2 = await handleGenerate(post(JSON.stringify(VALID)), bad);
    const t2 = await readAll(r2);
    expect(r2.status).toBe(502);
    expect(t2.body).toMatchObject({ error: { code: "upstream_error" } });
    expectNoKeyLeak(r2, t2.text);

    const hang = deps({
      timeoutMs: 20,
      fetch: ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("timed out", "TimeoutError")),
          );
        })) as unknown as typeof fetch,
    });
    const r3 = await handleGenerate(post(JSON.stringify(VALID)), hang);
    expect(r3.status).toBe(504);
    expect((await readAll(r3)).body).toMatchObject({ error: { code: "upstream_timeout" } });
  });

  it("500 internal_error on unexpected exception", async () => {
    const d = deps({
      limiter: {
        check: () => {
          throw new Error("boom");
        },
        size: () => 0,
      },
    });
    const res = await handleGenerate(post(JSON.stringify(VALID)), d);
    expect(res.status).toBe(500);
    expect((await readAll(res)).body).toMatchObject({ error: { code: "internal_error" } });
  });
});

describe("route files", () => {
  it("generate route exports config and 405 Allow: POST for other methods", () => {
    expect(generateRoute.runtime).toBe("nodejs");
    expect(generateRoute.maxDuration).toBe(60);
    expect(generateRoute.dynamic).toBe("force-dynamic");
    for (const m of [generateRoute.GET, generateRoute.PUT, generateRoute.PATCH, generateRoute.DELETE, generateRoute.HEAD, generateRoute.OPTIONS]) {
      const res = m();
      expect(res.status).toBe(405);
      expect(res.headers.get("allow")).toBe("POST");
    }
  });

  it("provider-status reports availability and model without the key", async () => {
    const res = await handleProviderStatus({
      env: { GEMINI_API_KEY: KEY, GEMINI_MODEL: "" },
      requireUser: fakeUser,
    });
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ geminiAvailable: true, model: "gemini-flash-latest" });
    expect(text).not.toContain(KEY);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const off = await handleProviderStatus({ env: { GEMINI_API_KEY: "" }, requireUser: fakeUser });
    expect(await off.json()).toMatchObject({ geminiAvailable: false });

    const r405 = statusRoute.POST();
    expect(r405.status).toBe(405);
    expect(r405.headers.get("allow")).toBe("GET");
  });
});

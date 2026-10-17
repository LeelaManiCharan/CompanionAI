/**
 * Model_Router (Req 6.1, 6.4–6.13, 6.15–6.22, 6.25, 6.26, 20.16).
 *
 * Browser-side, provider-agnostic routing of generation requests to Ollama
 * (direct, user's machine) or Gemini (same-origin Generate_Route proxy).
 *
 * The router never imports settings/profile services: callers pass the
 * current Settings to `refresh` / `generate`, and the router snapshots the
 * provider-relevant fields at request start (6.10, 6.26).
 */
import type { GenerationRequest, ProviderId } from "@/core/generation";
import type { ProviderMode, Settings } from "@/core/models";
import { select, type SelectedProvider } from "@/core/providerSelect";
import { DEFAULT_OLLAMA_BASE_URL, DEFAULT_OLLAMA_MODEL } from "@/core/validators";
import { fetchProviderStatus, geminiGenerate } from "./providers/gemini";
import { ollamaGenerate, ollamaHealthCheck } from "./providers/ollama";
import {
  abortError,
  isProviderError,
  ProviderError,
  type ProviderErrorInfo,
} from "./providers/types";

export {
  ProviderError,
  isProviderError,
  type BusyCode,
  type ModelProvider,
  type ProviderErrorInfo,
  type ProviderErrorKind,
} from "./providers/types";
export { OllamaProvider } from "./providers/ollama";
export { GeminiProxyProvider } from "./providers/gemini";

export const REQUEST_TIMEOUT_MS = 60_000;
export const HEALTH_STALE_MS = 60_000;

/** The Settings fields the router needs. */
export type RouterSettings = Pick<
  Settings,
  "profileId" | "providerMode" | "ollamaBaseUrl" | "ollamaModel" | "geminiNoticeAcknowledgedAt"
>;

export interface ActiveProviderState {
  /** Active_Provider, or `none` when no model is usable (6.20). */
  id: SelectedProvider;
  /** Auto mode chose gemini because Ollama was not detected (6.8). */
  fellBack: boolean;
  /** Server reports a key AND the browser is online (6.17, 20.16). */
  geminiAvailable: boolean;
  ollamaHealthy: boolean;
  mode: ProviderMode;
  online: boolean;
  /** Configured Gemini model name from the Provider_Status_Route, if known. */
  geminiModel: string | null;
}

export type TestTarget =
  | { provider: "ollama"; baseUrl: string; model: string }
  | { provider: "gemini" };

export type TestResult =
  | { ok: true; provider: ProviderId; model: string }
  | { ok: false; provider: ProviderId; error: ProviderErrorInfo };

/** Resolves true on "continue", false on "cancel" (6.21, 6.22). */
export type PrivacyNoticeHandler = () => Promise<boolean>;
/** Persist `geminiNoticeAcknowledgedAt` for the Profile (6.21). */
export type AcknowledgeHandler = (profileId: string, acknowledgedAt: string) => Promise<void> | void;

export interface GenerateOptions {
  signal?: AbortSignal;
  /** Overrides the router-level acknowledge handler for this call. */
  onAcknowledge?: AcknowledgeHandler;
}

interface Snapshot {
  profileId: string;
  mode: ProviderMode;
  baseUrl: string;
  model: string;
  acknowledged: boolean;
}

const INITIAL_STATE: ActiveProviderState = Object.freeze({
  id: "none",
  fellBack: false,
  geminiAvailable: false,
  ollamaHealthy: false,
  mode: "auto",
  online: true,
  geminiModel: null,
});

function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine !== false;
}

function snapshot(s: RouterSettings): Snapshot {
  return {
    profileId: s.profileId,
    mode: s.providerMode,
    baseUrl: s.ollamaBaseUrl.trim() === "" ? DEFAULT_OLLAMA_BASE_URL : s.ollamaBaseUrl,
    model: s.ollamaModel.trim() === "" ? DEFAULT_OLLAMA_MODEL : s.ollamaModel,
    acknowledged: s.geminiNoticeAcknowledgedAt !== null,
  };
}

function configKey(s: Snapshot): string {
  return `${s.profileId}\u0000${s.mode}\u0000${s.baseUrl}`;
}

function withTimeout(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([timeout, signal]) : timeout;
}

/** Waits for `p` but rejects as soon as `signal` aborts. */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal | undefined, provider: ProviderId): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(abortError(signal, provider));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal, provider));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

export class ModelRouter {
  private state: ActiveProviderState = INITIAL_STATE;
  private readonly listeners = new Set<(s: ActiveProviderState) => void>();

  private key: string | null = null;
  private lastHealthAt: number | null = null;
  private ollamaHealthy = false;
  /** Server-reported availability; `null` until the status route was read. */
  private geminiServer: boolean | null = null;
  private geminiModel: string | null = null;

  private noticeHandler: PrivacyNoticeHandler | null = null;
  private ackHandler: AcknowledgeHandler | null = null;
  private readonly acknowledgedProfiles = new Set<string>();
  private readonly pendingNotices = new Map<string, Promise<boolean>>();

  private onlineListenersAttached = false;

  constructor(private readonly now: () => number = Date.now) {}

  // ---------------------------------------------------------------------------
  // State / subscription (Provider_Badge, 6.7)
  // ---------------------------------------------------------------------------

  /** Stable snapshot; a new object only when something changed. */
  getState = (): ActiveProviderState => this.state;

  /** Same as `getState`; matches the design's `activeProvider()`. */
  activeProvider(): ActiveProviderState {
    return this.state;
  }

  /** `useSyncExternalStore`-compatible subscribe. */
  subscribe = (cb: (s: ActiveProviderState) => void): (() => void) => {
    this.listeners.add(cb);
    this.attachOnlineListeners();
    return () => {
      this.listeners.delete(cb);
    };
  };

  private attachOnlineListeners(): void {
    if (this.onlineListenersAttached || typeof window === "undefined") return;
    this.onlineListenersAttached = true;
    const sync = () => this.recompute(this.state.mode);
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
  }

  private emit(next: ActiveProviderState): void {
    const cur = this.state;
    if (
      cur.id === next.id &&
      cur.fellBack === next.fellBack &&
      cur.geminiAvailable === next.geminiAvailable &&
      cur.ollamaHealthy === next.ollamaHealthy &&
      cur.mode === next.mode &&
      cur.online === next.online &&
      cur.geminiModel === next.geminiModel
    ) {
      return;
    }
    this.state = Object.freeze(next);
    for (const l of [...this.listeners]) {
      try {
        l(this.state);
      } catch {
        /* a broken listener must not break routing */
      }
    }
  }

  /** Recomputes the Active_Provider from current knowledge and publishes it. */
  private recompute(mode: ProviderMode, forced?: SelectedProvider): SelectedProvider {
    const online = isOnline();
    const geminiServer = this.geminiServer === true;
    const id = forced ?? select(mode, this.ollamaHealthy, geminiServer, online);
    this.emit({
      id,
      fellBack: mode === "auto" && id === "gemini",
      geminiAvailable: geminiServer && online,
      ollamaHealthy: this.ollamaHealthy,
      mode,
      online,
      geminiModel: this.geminiModel,
    });
    return id;
  }

  // ---------------------------------------------------------------------------
  // Privacy notice gate (6.21, 6.22)
  // ---------------------------------------------------------------------------

  /** UI registers the dialog; resolves true on continue, false on cancel. */
  setPrivacyNoticeHandler(fn: PrivacyNoticeHandler | null): void {
    this.noticeHandler = fn;
  }

  /** Default persistence hook for `geminiNoticeAcknowledgedAt`. */
  setAcknowledgeHandler(fn: AcknowledgeHandler | null): void {
    this.ackHandler = fn;
  }

  private async ensureNotice(
    snap: Snapshot,
    signal: AbortSignal | undefined,
    onAcknowledge: AcknowledgeHandler | undefined,
  ): Promise<void> {
    if (snap.acknowledged || this.acknowledgedProfiles.has(snap.profileId)) return;
    const handler = this.noticeHandler;
    // No dialog registered: never send context to Google without consent.
    if (!handler) throw new ProviderError({ kind: "notice_declined" });

    let pending = this.pendingNotices.get(snap.profileId);
    if (!pending) {
      pending = (async () => {
        try {
          const ok = await handler();
          if (ok) {
            this.acknowledgedProfiles.add(snap.profileId);
            const persist = onAcknowledge ?? this.ackHandler;
            if (persist) await persist(snap.profileId, new Date(this.now()).toISOString());
          }
          return ok;
        } finally {
          this.pendingNotices.delete(snap.profileId);
        }
      })();
      this.pendingNotices.set(snap.profileId, pending);
    }

    const ok = await raceAbort(pending, signal, "gemini");
    if (!ok) throw new ProviderError({ kind: "notice_declined" });
  }

  // ---------------------------------------------------------------------------
  // Refresh (6.4, 6.16, 6.17, 20.16)
  // ---------------------------------------------------------------------------

  /**
   * Health check (auto mode) + Provider_Status_Route (auto/gemini mode).
   * Call on app start, profile change, and provider mode/base-URL save.
   * With `force: false`, only stale (> 60 s) or missing data is re-fetched.
   */
  async refresh(settings: RouterSettings, opts: { force?: boolean } = {}): Promise<void> {
    await this.refreshSnapshot(snapshot(settings), opts.force ?? true);
  }

  private async refreshSnapshot(snap: Snapshot, force: boolean): Promise<void> {
    const key = configKey(snap);
    if (key !== this.key) {
      this.key = key;
      this.lastHealthAt = null;
      this.ollamaHealthy = false;
    }

    const tasks: Promise<void>[] = [];

    if (snap.mode === "auto") {
      const stale = this.lastHealthAt === null || this.now() - this.lastHealthAt > HEALTH_STALE_MS;
      if (force || stale) {
        tasks.push(
          ollamaHealthCheck(snap.baseUrl).then((healthy) => {
            if (this.key !== key) return; // settings changed mid-flight
            this.ollamaHealthy = healthy;
            this.lastHealthAt = this.now();
          }),
        );
      }
    }

    if (snap.mode !== "ollama" && (force || this.geminiServer === null)) {
      if (isOnline()) {
        tasks.push(
          fetchProviderStatus().then((st) => {
            this.geminiServer = st.geminiAvailable;
            this.geminiModel = st.model === "" ? this.geminiModel : st.model;
          }),
        );
      }
    }

    await Promise.all(tasks);
    if (this.key === key) this.recompute(snap.mode);
  }

  // ---------------------------------------------------------------------------
  // Generate (6.1, 6.5, 6.6, 6.9–6.11, 6.18–6.22, 6.26)
  // ---------------------------------------------------------------------------

  async generate(
    settings: RouterSettings,
    req: GenerationRequest,
    opts: GenerateOptions = {},
  ): Promise<string> {
    const snap = snapshot(settings); // 6.10: frozen for the whole request
    const { signal } = opts;
    if (signal?.aborted) throw abortError(signal, "ollama");

    await this.refreshSnapshot(snap, false);
    if (signal?.aborted) throw abortError(signal, "ollama");

    const chosen = this.recompute(snap.mode);

    if (chosen === "none") {
      if (snap.mode === "gemini") {
        throw new ProviderError({
          kind: "unavailable",
          provider: "gemini",
          reason: isOnline() ? "not_configured" : "offline",
        });
      }
      throw new ProviderError({ kind: "no_model" });
    }

    if (chosen === "gemini") return this.sendGemini(snap, req, opts);

    try {
      return await ollamaGenerate(
        { baseUrl: snap.baseUrl, model: snap.model },
        req,
        withTimeout(signal, REQUEST_TIMEOUT_MS),
      );
    } catch (err) {
      if (!(isProviderError(err) && err.info.kind === "unreachable" && snap.mode === "auto")) {
        throw err;
      }
      // 6.9: auto mode → mark Ollama down, flip to gemini, resend once.
      if (this.key === configKey(snap)) {
        this.ollamaHealthy = false;
        this.lastHealthAt = this.now();
      }
      if (this.geminiServer === null && isOnline()) {
        const st = await fetchProviderStatus(signal);
        this.geminiServer = st.geminiAvailable;
        if (st.model !== "") this.geminiModel = st.model;
      }
      const next = this.recompute(snap.mode);
      if (next !== "gemini") throw new ProviderError({ kind: "no_model" });
      return this.sendGemini(snap, req, opts);
    }
  }

  private async sendGemini(
    snap: Snapshot,
    req: GenerationRequest,
    opts: GenerateOptions,
  ): Promise<string> {
    if (!isOnline()) {
      this.recompute(snap.mode);
      throw new ProviderError({ kind: "unavailable", provider: "gemini", reason: "offline" });
    }
    await this.ensureNotice(snap, opts.signal, opts.onAcknowledge);
    // Timeout starts after the notice so reading the dialog doesn't count.
    try {
      return await geminiGenerate(req, withTimeout(opts.signal, REQUEST_TIMEOUT_MS));
    } catch (err) {
      if (isProviderError(err) && err.info.kind === "unavailable") {
        this.geminiServer = false;
        this.recompute(snap.mode);
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // Connection test (6.25)
  // ---------------------------------------------------------------------------

  async testConnection(target: TestTarget, signal?: AbortSignal): Promise<TestResult> {
    const req: GenerationRequest = {
      task: "test",
      system: "This is a connection test. Reply with the single word OK.",
      messages: [{ role: "user", content: "ping" }],
    };
    const timed = withTimeout(signal, REQUEST_TIMEOUT_MS);

    if (target.provider === "ollama") {
      const baseUrl = target.baseUrl.trim() === "" ? DEFAULT_OLLAMA_BASE_URL : target.baseUrl;
      const model = target.model.trim() === "" ? DEFAULT_OLLAMA_MODEL : target.model;
      try {
        await ollamaGenerate({ baseUrl, model }, req, timed);
        return { ok: true, provider: "ollama", model };
      } catch (err) {
        if (isProviderError(err)) return { ok: false, provider: "ollama", error: err.info };
        throw err;
      }
    }

    if (!isOnline()) {
      return {
        ok: false,
        provider: "gemini",
        error: { kind: "unavailable", provider: "gemini", reason: "offline" },
      };
    }
    const st = await fetchProviderStatus(timed);
    this.geminiServer = st.geminiAvailable;
    if (st.model !== "") this.geminiModel = st.model;
    this.recompute(this.state.mode);
    if (!st.geminiAvailable) {
      return {
        ok: false,
        provider: "gemini",
        error: { kind: "unavailable", provider: "gemini", reason: "not_configured" },
      };
    }
    try {
      await geminiGenerate(req, timed);
      return { ok: true, provider: "gemini", model: st.model };
    } catch (err) {
      if (isProviderError(err)) return { ok: false, provider: "gemini", error: err.info };
      throw err;
    }
  }
}

/** App-wide router instance. */
export const modelRouter = new ModelRouter();

// -----------------------------------------------------------------------------
// Human-readable text
// -----------------------------------------------------------------------------

const PROVIDER_NAME: Record<ProviderId, string> = { ollama: "Ollama", gemini: "Gemini" };

export function currentOrigin(): string {
  return typeof window !== "undefined" && window.location ? window.location.origin : "";
}

/** 6.13: the exact command shown (mono + copy button) for a missing model. */
export function ollamaPullCommand(model: string): string {
  return `ollama pull ${model}`;
}

/** 6.12 / 6.20: the env assignment to show, using this app's origin. */
export function ollamaOriginsHint(origin: string = currentOrigin()): string {
  return `OLLAMA_ORIGINS=${origin || "<this site's origin>"}`;
}

export interface ErrorMessageContext {
  /** Defaults to `window.location.origin`. */
  origin?: string;
  /** Configured Ollama base URL, for the unreachable message. */
  baseUrl?: string;
}

export function providerErrorMessage(
  error: ProviderError | ProviderErrorInfo,
  ctx: ErrorMessageContext = {},
): string {
  const info = error instanceof ProviderError ? error.info : error;
  const origin = ctx.origin ?? currentOrigin();
  switch (info.kind) {
    case "unreachable":
      return (
        `Ollama could not be reached${ctx.baseUrl ? ` at ${ctx.baseUrl}` : ""}. ` +
        `Start Ollama. If it is already running, set ${ollamaOriginsHint(origin)} ` +
        `so it accepts requests from this site, then restart Ollama.`
      );
    case "model_not_installed":
      return `The Ollama model "${info.model}" is not installed. Run: ${ollamaPullCommand(info.model)}`;
    case "timeout":
      return `${PROVIDER_NAME[info.provider]} did not respond within 60 seconds. Please try again.`;
    case "busy": {
      const base =
        "The hosted model is busy or its quota is reached. Try again later or run Ollama locally.";
      return info.code === "rate_limited_local" && info.retryAfterS !== undefined
        ? `${base} You can retry in ${info.retryAfterS} seconds.`
        : base;
    }
    case "unavailable":
      return info.reason === "offline"
        ? "You're offline, so the hosted model is unavailable. Reconnect or run Ollama locally."
        : "The hosted model is not configured on this deployment. You can run Ollama locally.";
    case "notice_declined":
      return "A reply needs you to acknowledge the hosted-model privacy notice, or run Ollama locally.";
    case "no_model":
      return (
        "No model is available. Start Ollama with " +
        `${ollamaOriginsHint(origin)} set so it accepts requests from this site.`
      );
    case "upstream":
      return `${PROVIDER_NAME[info.provider]} returned an error${
        info.status !== undefined ? ` (HTTP ${info.status})` : ""
      }. Please try again.`;
  }
}

/** Provider_Badge label (6.7, 6.8, 6.17). */
export function providerBadgeLabel(state: ActiveProviderState): string {
  switch (state.id) {
    case "ollama":
      return "Ollama (local)";
    case "gemini":
      return state.fellBack ? "Gemini (hosted, Ollama not detected)" : "Gemini (hosted)";
    case "none":
      return state.mode === "gemini" ? "Gemini (unavailable)" : "No model available";
  }
}

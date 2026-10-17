"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { ProviderBadge, useCanWrite, useSettings } from "@/components/app";
import { Badge, Button, Field, InlineAlert, SegmentedControl, TextInput, useToast } from "@/components/ui";
import type { ProviderMode } from "@/core/models";
import {
  DEFAULT_OLLAMA_BASE_URL,
  DEFAULT_OLLAMA_MODEL,
  validateOllamaBaseUrl,
  validateOllamaModel,
} from "@/core/validators";
import {
  modelRouter,
  ollamaOriginsHint,
  ollamaPullCommand,
  providerErrorMessage,
  type TestResult,
} from "@/services/modelRouter";
import { saveOllama, saveProviderMode } from "@/services/settingsService";
import { useProviderState } from "@/services/useProviderState";
import { CopyableCode } from "./CopyableCode";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { usePendingValue } from "./usePendingValue";

const MODES: { value: ProviderMode; label: string; help: string }[] = [
  {
    value: "auto",
    label: "Auto",
    help: "Uses Ollama on this computer when it's running. Otherwise falls back to the hosted Gemini model.",
  },
  {
    value: "ollama",
    label: "Ollama only",
    help: "Only your local Ollama is used. Conversations stay on your machine, and nothing is sent to the hosted model.",
  },
  {
    value: "gemini",
    label: "Hosted Gemini",
    help: "Always uses the hosted Gemini model through this site's server, even when Ollama is running.",
  },
];

type TestState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: TestResult }
  | { status: "crashed"; message: string };

/** Provider mode, Ollama settings, connection tests, and the hosted-model notice (Req 6, 6A.13, 20.16). */
export function ModelSection({ index }: { index: string }) {
  const settings = useSettings();
  const canWrite = useCanWrite();
  const provider = useProviderState();
  const { toast } = useToast();

  const [mode, chooseMode, revertMode] = usePendingValue<ProviderMode>(settings.providerMode);
  const [modeError, setModeError] = useState<string | null>(null);

  const [baseUrl, setBaseUrl] = useState(settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL);
  const [model, setModel] = useState(settings.ollamaModel || DEFAULT_OLLAMA_MODEL);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [modelError, setModelError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [ollamaTest, setOllamaTest] = useState<TestState>({ status: "idle" });
  const [geminiTest, setGeminiTest] = useState<TestState>({ status: "idle" });

  const savedUrl = settings.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL;
  const savedModel = settings.ollamaModel || DEFAULT_OLLAMA_MODEL;
  const dirty = baseUrl.trim() !== savedUrl || model.trim() !== savedModel;

  const changeMode = async (next: ProviderMode) => {
    if (!canWrite || next === mode) return;
    setModeError(null);
    chooseMode(next);
    const res = await saveProviderMode(next);
    if (!res.ok) {
      revertMode();
      setModeError(res.error);
    }
  };

  const saveOllamaConfig = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite || saving) return;
    const u = validateOllamaBaseUrl(baseUrl);
    const m = validateOllamaModel(model);
    setUrlError(u.ok ? null : u.error);
    setModelError(m.ok ? null : m.error);
    setFormError(null);
    if (!u.ok || !m.ok) return;
    setSaving(true);
    const res = await saveOllama(baseUrl, model);
    setSaving(false);
    if (!res.ok) {
      setFormError(res.error);
      return;
    }
    setBaseUrl(res.value.ollamaBaseUrl);
    setModel(res.value.ollamaModel);
    toast({ title: "Ollama settings saved", tone: "success" });
  };

  const runTest = async (target: "ollama" | "gemini") => {
    const set = target === "ollama" ? setOllamaTest : setGeminiTest;
    set({ status: "running" });
    try {
      const result =
        target === "ollama"
          ? await modelRouter.testConnection({ provider: "ollama", baseUrl, model })
          : await modelRouter.testConnection({ provider: "gemini" });
      set({ status: "done", result });
      // Refresh the badge with what the test just learned.
      void modelRouter.refresh(settings, { force: true }).catch(() => undefined);
    } catch {
      set({ status: "crashed", message: "The connection test couldn't run. Please try again." });
    }
  };

  const geminiNotConfigured =
    (geminiTest.status === "done" &&
      !geminiTest.result.ok &&
      geminiTest.result.error.kind === "unavailable" &&
      geminiTest.result.error.reason === "not_configured") ||
    (provider.online && !provider.geminiAvailable && mode !== "ollama");

  const modeHelp = MODES.find((m) => m.value === mode)?.help;

  return (
    <SettingsSection
      id="model"
      index={index}
      title="Model"
      description="Choose where replies come from. Your local Ollama keeps conversations on your machine."
      meta={<ProviderBadge full />}
    >
      <SettingsRow>
        <SegmentedControl
          label="Provider"
          options={MODES.map((m) => ({ value: m.value, label: m.label }))}
          value={mode}
          onChange={(m) => void changeMode(m)}
          disabled={!canWrite}
        />
        <p className="mt-2 max-w-xl text-[13px] leading-5 text-muted" aria-live="polite">
          {modeHelp}
        </p>
        {modeError ? (
          <InlineAlert tone="danger" className="mt-3">
            {modeError}
          </InlineAlert>
        ) : null}

        <dl className="mt-4 grid gap-px overflow-hidden rounded-md border border-border bg-border text-[13px] sm:grid-cols-2">
          <StatusCell label="Ollama (local)">
            {provider.ollamaHealthy ? (
              <Badge tone="green" dot>
                Detected
              </Badge>
            ) : (
              <Badge dot>Not detected</Badge>
            )}
          </StatusCell>
          <StatusCell label="Gemini (hosted)">
            {!provider.online ? (
              <Badge dot>Offline</Badge>
            ) : provider.geminiAvailable ? (
              <span className="flex items-center gap-2">
                <Badge tone="green" dot>
                  Available
                </Badge>
                {provider.geminiModel ? (
                  <code className="truncate font-mono text-[12px] text-muted">{provider.geminiModel}</code>
                ) : null}
              </span>
            ) : (
              <Badge dot>Unavailable</Badge>
            )}
          </StatusCell>
        </dl>
      </SettingsRow>

      <SettingsRow>
        <form onSubmit={saveOllamaConfig} noValidate className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <Field label="Ollama base URL" error={urlError} hint={urlError ? undefined : "Usually http://localhost:11434"}>
              <TextInput
                mono
                type="url"
                inputMode="url"
                spellCheck={false}
                autoComplete="off"
                value={baseUrl}
                maxLength={2048}
                disabled={!canWrite}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setUrlError(null);
                  setFormError(null);
                }}
              />
            </Field>
            <Field label="Model" error={modelError} hint={modelError ? undefined : "Any model you've pulled."}>
              <TextInput
                mono
                spellCheck={false}
                autoComplete="off"
                value={model}
                maxLength={100}
                disabled={!canWrite}
                onChange={(e) => {
                  setModel(e.target.value);
                  setModelError(null);
                  setFormError(null);
                }}
              />
            </Field>
          </div>
          {formError ? <InlineAlert tone="danger">{formError}</InlineAlert> : null}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" loading={saving} disabled={!canWrite || !dirty}>
              Save Ollama settings
            </Button>
            <Button variant="secondary" loading={ollamaTest.status === "running"} onClick={() => void runTest("ollama")}>
              Test Ollama
            </Button>
            <Button variant="secondary" loading={geminiTest.status === "running"} onClick={() => void runTest("gemini")}>
              Test hosted model
            </Button>
          </div>
          <p className="text-[13px] text-muted">Tests use the values above, even before you save them.</p>
        </form>

        <TestOutcome state={ollamaTest} baseUrl={baseUrl} onDismiss={() => setOllamaTest({ status: "idle" })} />
        <TestOutcome state={geminiTest} onDismiss={() => setGeminiTest({ status: "idle" })} />

        {!provider.online && mode !== "ollama" ? (
          <InlineAlert tone="warning" className="mt-4">
            You&apos;re offline, so the hosted model is unavailable. Ollama keeps working if it&apos;s running.
          </InlineAlert>
        ) : geminiNotConfigured ? (
          <InlineAlert tone="warning" title="Hosted model not configured on this deployment" className="mt-4">
            This site has no Gemini key set up, so only Ollama can reply. You can run Ollama locally.
          </InlineAlert>
        ) : null}
      </SettingsRow>

      <SettingsRow className="bg-bg-subtle">
        <HostedPrivacyNote />
      </SettingsRow>
    </SettingsSection>
  );
}

function StatusCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 bg-bg px-3.5 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function TestOutcome({ state, baseUrl, onDismiss }: { state: TestState; baseUrl?: string; onDismiss: () => void }) {
  if (state.status === "idle" || state.status === "running") return null;
  if (state.status === "crashed") {
    return (
      <InlineAlert tone="danger" onDismiss={onDismiss} className="mt-4">
        {state.message}
      </InlineAlert>
    );
  }
  const { result } = state;
  const name = result.provider === "ollama" ? "Ollama" : "Hosted model";
  if (result.ok) {
    return (
      <InlineAlert tone="success" title={`${name} is working`} onDismiss={onDismiss} className="mt-4">
        Replied using{" "}
        <code className="font-mono text-[13px]">{result.model || (result.provider === "gemini" ? "Gemini" : "")}</code>.
      </InlineAlert>
    );
  }
  const err = result.error;
  return (
    <InlineAlert tone="danger" title={`${name} test failed`} onDismiss={onDismiss} className="mt-4">
      <p>{providerErrorMessage(err, { baseUrl })}</p>
      {err.kind === "unreachable" ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="text-[13px] text-muted">Set this before starting Ollama, then restart it:</p>
          <CopyableCode code={ollamaOriginsHint()} label="Copy OLLAMA_ORIGINS setting" />
        </div>
      ) : null}
      {err.kind === "model_not_installed" ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="text-[13px] text-muted">Run this in a terminal:</p>
          <CopyableCode code={ollamaPullCommand(err.model)} label="Copy ollama pull command" />
        </div>
      ) : null}
    </InlineAlert>
  );
}

/** Always visible (6.21, 6A.13). */
function HostedPrivacyNote() {
  return (
    <div className="flex flex-col gap-2 text-sm">
      <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted">About the hosted model</p>
      <ul className="flex list-disc flex-col gap-1.5 pl-4 leading-6 text-text/85">
        <li>
          When Gemini replies, your chat context (recent messages, your profile summary, and related memories) is sent
          to Google through this site&apos;s server.
        </li>
        <li>
          The hosted endpoint has no login. Anyone with this site&apos;s link can use it, so the shared free quota may
          run out. Rate limiting is best-effort only.
        </li>
        <li>Choose Ollama only to keep every conversation on your own machine.</li>
      </ul>
    </div>
  );
}

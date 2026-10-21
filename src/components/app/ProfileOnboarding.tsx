"use client";

import { useState, type FormEvent } from "react";
import { Button, Field, IconCheck, InlineAlert, TextInput } from "@/components/ui";
import type { RepoMode } from "@/data/repository";
import { validateDisplayName } from "@/core/validators";
import { createProfile } from "@/services/profileService";
import { BackupPanel } from "@/components/backup";
import { AiDisclaimer } from "./AiDisclaimer";
import { Wordmark } from "./BrandMark";
import { HelpButton } from "./HelpButton";
import { RepoModeAlert } from "./AppNotices";

const POINTS = [
  "Text or voice check-ins with a friendly AI companion",
  "Everything is stored on this device, not in an account",
  "Up to 3 profiles in this browser",
] as const;

/**
 * Zero-profile creation screen (1.1, 1.5, 1.7, 1.9). After creation the new
 * Profile becomes active and AppRoot shows the activity disclosure (11.1).
 */
export function ProfileOnboarding({ repoMode }: { repoMode: RepoMode }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canWrite = repoMode === "ready";

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || !canWrite) return;
    setFailure(null);
    const v = validateDisplayName(name);
    if (!v.ok) {
      // Keep the entered text so it can be corrected (1.7).
      setError(v.error);
      return;
    }
    setError(null);
    setBusy(true);
    const res = await createProfile(name);
    setBusy(false);
    if (!res.ok) setFailure(res.error);
  };

  return (
    <div className="flex min-h-dvh flex-col bg-bg-subtle">
      <header className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Wordmark />
        <HelpButton />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-8 sm:items-center sm:pt-0">
        <div className="grid w-full max-w-4xl gap-10 md:grid-cols-[1fr_400px] md:items-center">
          <section aria-labelledby="welcome-title" className="max-w-md">
            <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-gradient-brand">Welcome</p>
            <h1 id="welcome-title" className="mt-3 text-[32px] leading-[1.15] tracking-[-0.035em] text-text sm:text-[40px]">
              A calm place to check in with yourself, every day.
            </h1>
            <ul className="mt-6 flex flex-col gap-2.5">
              {POINTS.map((p) => (
                <li key={p} className="flex items-start gap-2.5 text-[15px] leading-6 text-text/85">
                  <span className="mt-[3px] inline-flex size-[18px] shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                    <IconCheck size={12} strokeWidth={2.25} />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-labelledby="create-title"
            className="rounded-lg border border-border bg-bg p-6 shadow-[0_1px_2px_rgb(17_24_20/0.04),0_8px_24px_rgb(17_24_20/0.05)]"
          >
            <h2 id="create-title" className="text-lg leading-7 text-text">
              Create your profile
            </h2>
            <p className="mt-1 text-sm text-muted">Just a name your companion can call you.</p>

            {!canWrite ? <RepoModeAlert mode={repoMode} className="mt-5" /> : null}

            <form onSubmit={submit} noValidate className="mt-5 flex flex-col gap-5">
              <Field label="Your name" hint={error ? undefined : "1 to 40 characters."} error={error} required>
                <TextInput
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    if (error) setError(null);
                  }}
                  autoComplete="given-name"
                  placeholder="e.g. Alex"
                  disabled={!canWrite}
                  autoFocus
                />
              </Field>
              {failure ? <InlineAlert tone="danger">{failure}</InlineAlert> : null}
              <Button type="submit" size="lg" fullWidth loading={busy} disabled={!canWrite}>
                Create profile
              </Button>
            </form>
          </section>

          {/* Secondary path (20.21): browser data was cleared, bring it back from a backup. */}
          <section aria-labelledby="restore-title" className="md:col-span-2">
            <details className="group rounded-lg border border-border bg-bg">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-6 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
                <span>
                  <span id="restore-title" className="block text-[15px] font-semibold text-text">
                    Restore from a backup
                  </span>
                  <span className="mt-0.5 block text-sm text-muted">
                    Used this app before? Enter your Supabase details and namespace ID, or import a backup file.
                  </span>
                </span>
                <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <div className="border-t border-border px-6 py-6">
                <BackupPanel showBackup={false} showExport={false} />
              </div>
            </details>
          </section>
        </div>
      </main>

      <footer className="mx-auto w-full max-w-6xl px-4 pb-6 sm:px-6">
        <AiDisclaimer />
      </footer>
    </div>
  );
}

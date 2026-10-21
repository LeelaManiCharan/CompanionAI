"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Field, IconCheckCircle, InlineAlert, Spinner, TextInput } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { AuthCard, authLinkClass } from "./AuthCard";
import {
  authErrorCode,
  fieldErrors,
  isNetworkError,
  isRateLimited,
  MESSAGES,
  newPasswordFormSchema,
  PASSWORD_MAX,
  PASSWORD_MIN,
  redirectErrorFromUrl,
  resetRequestSchema,
  type FieldErrors,
} from "./authForms";
import { useAuth } from "./AuthProvider";
import { PasswordInput } from "./PasswordInput";

/** How long to wait for the PASSWORD_RECOVERY event after arriving with a `code`. */
const RECOVERY_GRACE_MS = 2500;

/**
 * /reset-password (22.3). Without a recovery session: request a reset email
 * that links back here. Arriving from that email (PASSWORD_RECOVERY): set a
 * new password of 8–72 characters, then open Home.
 */
export function ResetPasswordForm() {
  const params = useSearchParams();
  const { passwordRecovery, status } = useAuth();
  const hasCode = params.has("code");
  const [linkFailed, setLinkFailed] = useState(false);

  useEffect(() => {
    if (redirectErrorFromUrl(new URLSearchParams(window.location.search)) !== null) setLinkFailed(true);
  }, []);

  // Came from the email but no recovery session arrived: the link is stale.
  useEffect(() => {
    if (!hasCode || passwordRecovery || status === "loading") return;
    const t = setTimeout(() => setLinkFailed(true), RECOVERY_GRACE_MS);
    return () => clearTimeout(t);
  }, [hasCode, passwordRecovery, status]);

  if (passwordRecovery) return <NewPasswordForm />;
  if (hasCode && !linkFailed) return <CheckingLink />;
  return <RequestResetForm linkFailed={linkFailed} />;
}

function CheckingLink() {
  return (
    <AuthCard eyebrow="Reset password" title="Checking your link">
      <div role="status" className="flex items-center gap-3 text-sm text-muted">
        <Spinner size={18} className="text-primary" />
        One moment while we verify your reset link.
      </div>
    </AuthCard>
  );
}

function RequestResetForm({ linkFailed }: { linkFailed: boolean }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setFormError(null);
    const parsed = resetRequestSchema.safeParse({ email });
    if (!parsed.success) {
      setError(fieldErrors<"email">(parsed.error).email);
      emailRef.current?.focus();
      return;
    }
    setError(undefined);
    const sb = getBrowserSupabase();
    if (!sb) return;
    setBusy(true);
    try {
      const { error: err } = await sb.auth.resetPasswordForEmail(parsed.data.email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      // Only transport problems are reported; anything else gets the same
      // neutral confirmation, so the page never reveals whether an account exists.
      if (err && (isNetworkError(err) || isRateLimited(err))) {
        setFormError(isNetworkError(err) ? MESSAGES.network : MESSAGES.rateLimited);
      } else {
        setSentTo(parsed.data.email);
      }
    } catch (err) {
      setFormError(isNetworkError(err) ? MESSAGES.network : MESSAGES.generic);
    } finally {
      setBusy(false);
    }
  };

  const footer = (
    <>
      Remembered it?{" "}
      <Link href="/login" className={authLinkClass}>
        Back to sign in
      </Link>
    </>
  );

  if (sentTo) {
    return (
      <AuthCard eyebrow="Reset password" title="Check your inbox" footer={footer}>
        <div className="flex flex-col gap-4">
          <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-accent px-4 py-3.5">
            <IconCheckCircle size={20} className="mt-0.5 shrink-0 text-primary" />
            <p role="status" className="text-sm leading-5 text-text">
              If an account exists for <span className="break-all font-medium">{sentTo}</span>, you&apos;ll get an email
              with a link to choose a new password.
            </p>
          </div>
          <p className="text-[13px] leading-5 text-muted">
            Open the link in this browser. Didn&apos;t get it?{" "}
            <button type="button" className={authLinkClass} onClick={() => setSentTo(null)}>
              Try again
            </button>
          </p>
        </div>
      </AuthCard>
    );
  }

  return (
    <AuthCard
      eyebrow="Reset password"
      title="Forgot your password?"
      description="Enter your email and we'll send you a link to choose a new one."
      footer={footer}
    >
      {linkFailed ? (
        <InlineAlert tone="info" className="mb-5" title="That reset link didn't work">
          It may have expired or already been used. Request a new one below.
        </InlineAlert>
      ) : null}
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
        <Field label="Email" error={error}>
          <TextInput
            ref={emailRef}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        {formError ? <InlineAlert tone="danger">{formError}</InlineAlert> : null}
        <Button type="submit" size="lg" fullWidth loading={busy}>
          {busy ? "Sending link…" : "Send reset link"}
        </Button>
      </form>
    </AuthCard>
  );
}

type PwKey = "password" | "confirm";

function newPasswordError(err: unknown): string {
  if (isNetworkError(err)) return MESSAGES.network;
  if (isRateLimited(err)) return MESSAGES.rateLimited;
  switch (authErrorCode(err)) {
    case "same_password":
      return "Choose a password that's different from your current one.";
    case "weak_password":
      return "That password is too easy to guess. Try a longer one.";
    case "session_expired":
    case "session_not_found":
      return "Your reset link has expired. Request a new one.";
    default:
      return "We couldn't update your password. Please try again.";
  }
}

function NewPasswordForm() {
  const router = useRouter();
  const [values, setValues] = useState<Record<PwKey, string>>({ password: "", confirm: "" });
  const [errors, setErrors] = useState<FieldErrors<PwKey>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);

  const update = (key: PwKey, value: string) => {
    const next = { ...values, [key]: value };
    setValues(next);
    if (submitted) {
      const parsed = newPasswordFormSchema.safeParse(next);
      setErrors(parsed.success ? {} : fieldErrors<PwKey>(parsed.error));
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setFormError(null);
    const parsed = newPasswordFormSchema.safeParse(values);
    if (!parsed.success) {
      const errs = fieldErrors<PwKey>(parsed.error);
      setErrors(errs);
      (errs.password ? passwordRef : confirmRef).current?.focus();
      return;
    }
    setErrors({});
    const sb = getBrowserSupabase();
    if (!sb) return;
    setBusy(true);
    try {
      const { error } = await sb.auth.updateUser({ password: parsed.data.password });
      if (error) {
        setFormError(newPasswordError(error));
        setBusy(false);
        return;
      }
      router.replace("/");
    } catch (err) {
      setFormError(newPasswordError(err));
      setBusy(false);
    }
  };

  return (
    <AuthCard
      eyebrow="Reset password"
      title="Choose a new password"
      description="You're signed in from your reset link. Pick a new password to continue."
    >
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
        <Field label="New password" hint={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`} error={errors.password}>
          <PasswordInput
            ref={passwordRef}
            name="new-password"
            autoComplete="new-password"
            autoFocus
            value={values.password}
            onChange={(e) => update("password", e.target.value)}
          />
        </Field>
        <Field label="Confirm new password" error={errors.confirm}>
          <PasswordInput
            ref={confirmRef}
            name="confirm-password"
            autoComplete="new-password"
            value={values.confirm}
            onChange={(e) => update("confirm", e.target.value)}
          />
        </Field>
        {formError ? <InlineAlert tone="danger">{formError}</InlineAlert> : null}
        <Button type="submit" size="lg" fullWidth loading={busy}>
          {busy ? "Saving…" : "Save and continue"}
        </Button>
      </form>
    </AuthCard>
  );
}

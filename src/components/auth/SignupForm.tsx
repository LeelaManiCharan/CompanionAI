"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { Button, ButtonLink, Field, IconCheckCircle, InlineAlert, TextInput } from "@/components/ui";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { AuthCard, authLinkClass } from "./AuthCard";
import {
  authErrorCode,
  DISPLAY_NAME_MAX,
  fieldErrors,
  isNetworkError,
  isRateLimited,
  MESSAGES,
  PASSWORD_MAX,
  PASSWORD_MIN,
  signupSchema,
  type FieldErrors,
} from "./authForms";
import { PasswordInput } from "./PasswordInput";

type Key = "displayName" | "email" | "password";
type Values = Record<Key, string>;

function signupErrorMessage(err: unknown): string {
  if (isNetworkError(err)) return MESSAGES.network;
  if (isRateLimited(err)) return MESSAGES.rateLimited;
  switch (authErrorCode(err)) {
    case "weak_password":
      return "That password is too easy to guess. Try a longer one, or mix in numbers and symbols.";
    case "user_already_exists":
    case "email_exists":
      return "An account with this email already exists. Sign in instead.";
    case "signup_disabled":
      return "New sign-ups are turned off for this app.";
    default:
      return "We couldn't create your account. Please try again.";
  }
}

const emailRedirect = () => `${window.location.origin}/login`;

/**
 * /signup (22.1): display name (stored in user metadata as `display_name`
 * for preferences seeding), email, and password. Shows a confirm-your-email
 * message when Supabase requires it, otherwise signs in and opens Home.
 */
export function SignupForm() {
  const router = useRouter();
  const [values, setValues] = useState<Values>({ displayName: "", email: "", password: "" });
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState<string | null>(null);
  const refs = {
    displayName: useRef<HTMLInputElement>(null),
    email: useRef<HTMLInputElement>(null),
    password: useRef<HTMLInputElement>(null),
  };

  const update = (key: Key, value: string) => {
    const nextValues = { ...values, [key]: value };
    setValues(nextValues);
    if (submitted) {
      const parsed = signupSchema.safeParse(nextValues);
      setErrors(parsed.success ? {} : fieldErrors<Key>(parsed.error));
    }
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setFormError(null);
    const parsed = signupSchema.safeParse(values);
    if (!parsed.success) {
      const errs = fieldErrors<Key>(parsed.error);
      setErrors(errs);
      const first = (["displayName", "email", "password"] as const).find((k) => errs[k]);
      if (first) refs[first].current?.focus();
      return;
    }
    setErrors({});
    const sb = getBrowserSupabase();
    if (!sb) return;
    setBusy(true);
    try {
      const { displayName, email, password } = parsed.data;
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { display_name: displayName }, emailRedirectTo: emailRedirect() },
      });
      if (error) {
        setFormError(signupErrorMessage(error));
        setBusy(false);
        return;
      }
      if (data.session) {
        router.replace("/");
        return;
      }
      // Email confirmation required (also the response for an existing email,
      // so this never reveals whether an account exists).
      setConfirmEmail(email);
      setBusy(false);
    } catch (err) {
      setFormError(signupErrorMessage(err));
      setBusy(false);
    }
  };

  if (confirmEmail) return <ConfirmEmail email={confirmEmail} />;

  return (
    <AuthCard
      eyebrow="Get started"
      title="Create your account"
      description="Your chats and memories stay on this device. Your account keeps them yours."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className={authLinkClass}>
            Sign in
          </Link>
        </>
      }
    >
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5">
        <Field label="Your name" hint="What your companion will call you." error={errors.displayName}>
          <TextInput
            ref={refs.displayName}
            name="name"
            autoComplete="given-name"
            autoFocus
            maxLength={DISPLAY_NAME_MAX}
            value={values.displayName}
            onChange={(e) => update("displayName", e.target.value)}
            placeholder="Alex"
          />
        </Field>
        <Field label="Email" error={errors.email}>
          <TextInput
            ref={refs.email}
            type="email"
            name="email"
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            spellCheck={false}
            value={values.email}
            onChange={(e) => update("email", e.target.value)}
            placeholder="you@example.com"
          />
        </Field>
        <Field label="Password" hint={`${PASSWORD_MIN} to ${PASSWORD_MAX} characters.`} error={errors.password}>
          <PasswordInput
            ref={refs.password}
            name="new-password"
            autoComplete="new-password"
            value={values.password}
            onChange={(e) => update("password", e.target.value)}
          />
        </Field>

        {formError ? <InlineAlert tone="danger">{formError}</InlineAlert> : null}

        <Button type="submit" size="lg" fullWidth loading={busy}>
          {busy ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </AuthCard>
  );
}

function ConfirmEmail({ email }: { email: string }) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const resend = async () => {
    const sb = getBrowserSupabase();
    if (!sb || state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const { error: err } = await sb.auth.resend({ type: "signup", email, options: { emailRedirectTo: emailRedirect() } });
      if (err) {
        setError(isNetworkError(err) ? MESSAGES.network : isRateLimited(err) ? MESSAGES.rateLimited : MESSAGES.generic);
        setState("error");
        return;
      }
      setState("sent");
    } catch (err) {
      setError(isNetworkError(err) ? MESSAGES.network : MESSAGES.generic);
      setState("error");
    }
  };

  return (
    <AuthCard
      eyebrow="One more step"
      title="Check your inbox"
      footer={
        <>
          Confirmed already?{" "}
          <Link href="/login" className={authLinkClass}>
            Sign in
          </Link>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex items-start gap-3 rounded-md border border-primary/20 bg-accent px-4 py-3.5">
          <IconCheckCircle size={20} className="mt-0.5 shrink-0 text-primary" />
          <p className="text-sm leading-5 text-text" role="status">
            We sent a confirmation link to <span className="break-all font-medium">{email}</span>. Open it in this
            browser to finish creating your account.
          </p>
        </div>
        <p className="text-[13px] leading-5 text-muted">
          Can&apos;t find it? Check your spam folder, or send it again.
        </p>
        {state === "sent" ? (
          <InlineAlert tone="success">A new link is on its way.</InlineAlert>
        ) : error ? (
          <InlineAlert tone="danger">{error}</InlineAlert>
        ) : null}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button variant="secondary" fullWidth loading={state === "sending"} onClick={() => void resend()}>
            Resend email
          </Button>
          <ButtonLink href="/login" variant="primary" fullWidth>
            Back to sign in
          </ButtonLink>
        </div>
      </div>
    </AuthCard>
  );
}

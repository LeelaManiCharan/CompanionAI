"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Field, InlineAlert, TextInput } from "@/components/ui";
import { safeNextPath } from "@/lib/authPaths";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { AuthCard, authLinkClass } from "./AuthCard";
import { fieldErrors, isNetworkError, isRateLimited, loginSchema, MESSAGES, redirectErrorFromUrl, type FieldErrors } from "./authForms";
import { useAuth } from "./AuthProvider";
import { PasswordInput } from "./PasswordInput";

type Key = "email" | "password";

/** /login (22.2): email + password sign-in, then the originally requested page. */
export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const next = safeNextPath(params.get("next"));
  const { status } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<Key>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkError, setLinkError] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  // An expired or reused confirmation link lands here with an error.
  useEffect(() => {
    setLinkError(redirectErrorFromUrl(new URLSearchParams(window.location.search)) !== null);
  }, []);

  // Signed in (this form, or an email confirmation link exchanged on this page).
  useEffect(() => {
    if (status === "signed_in") router.replace(next);
  }, [status, next, router]);

  const validate = (values: { email: string; password: string }) => {
    const parsed = loginSchema.safeParse(values);
    return parsed.success ? { ok: true as const, data: parsed.data } : { ok: false as const, errors: fieldErrors<Key>(parsed.error) };
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    setSubmitted(true);
    setFormError(null);
    const v = validate({ email, password });
    if (!v.ok) {
      setErrors(v.errors);
      (v.errors.email ? emailRef : passwordRef).current?.focus();
      return;
    }
    setErrors({});
    const sb = getBrowserSupabase();
    if (!sb) return;
    setBusy(true);
    try {
      const { error } = await sb.auth.signInWithPassword(v.data);
      if (error) {
        setFormError(
          isNetworkError(error) ? MESSAGES.network : isRateLimited(error) ? MESSAGES.rateLimited : MESSAGES.invalidCredentials,
        );
        setBusy(false);
        return;
      }
      // Keep the button busy through navigation.
      router.replace(next);
    } catch (err) {
      setFormError(isNetworkError(err) ? MESSAGES.network : MESSAGES.invalidCredentials);
      setBusy(false);
    }
  };

  // Re-validate as the user fixes fields after a failed submit.
  const revalidate = (values: { email: string; password: string }) => {
    if (!submitted) return;
    const v = validate(values);
    setErrors(v.ok ? {} : v.errors);
  };

  return (
    <AuthCard
      eyebrow="Welcome back"
      title="Sign in"
      description="Pick up where you left off with your companion."
      footer={
        <>
          New here?{" "}
          <Link href="/signup" className={authLinkClass}>
            Create an account
          </Link>
        </>
      }
    >
      {linkError ? (
        <InlineAlert tone="info" className="mb-5" title="That link has expired">
          The confirmation link was already used or is too old. Sign in below, or create your account again.
        </InlineAlert>
      ) : null}
      <form noValidate onSubmit={(e) => void onSubmit(e)} className="flex flex-col gap-5" aria-describedby={formError ? "login-error" : undefined}>
        <Field label="Email" error={errors.email}>
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
            onChange={(e) => {
              setEmail(e.target.value);
              revalidate({ email: e.target.value, password });
            }}
            placeholder="you@example.com"
          />
        </Field>
        <div className="flex flex-col gap-1.5">
          <Field label="Password" error={errors.password}>
            <PasswordInput
              ref={passwordRef}
              name="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                revalidate({ email, password: e.target.value });
              }}
            />
          </Field>
          <div className="flex justify-end">
            <Link href="/reset-password" className={`${authLinkClass} text-[13px]`}>
              Forgot password?
            </Link>
          </div>
        </div>

        {formError ? (
          <InlineAlert id="login-error" tone="danger">
            {formError}
          </InlineAlert>
        ) : null}

        <Button type="submit" size="lg" fullWidth loading={busy}>
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </AuthCard>
  );
}

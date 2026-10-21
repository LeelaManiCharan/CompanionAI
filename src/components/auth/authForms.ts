/**
 * Validation and error copy for the auth pages (Req 22.1–22.3).
 */
import { z, type ZodError } from "zod";

export const DISPLAY_NAME_MAX = 40;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
const EMAIL_MAX = 254;

export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Enter your name.")
  .max(DISPLAY_NAME_MAX, `Use ${DISPLAY_NAME_MAX} characters or fewer.`);

export const emailSchema = z
  .string()
  .trim()
  .min(1, "Enter your email address.")
  .max(EMAIL_MAX, "That email address is too long.")
  .email("Enter a valid email address.");

export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters.`)
  .max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`);

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password.").max(PASSWORD_MAX, `Use ${PASSWORD_MAX} characters or fewer.`),
});

export const signupSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: newPasswordSchema,
});

export const resetRequestSchema = z.object({ email: emailSchema });

export const newPasswordFormSchema = z
  .object({ password: newPasswordSchema, confirm: z.string() })
  .refine((v) => v.password === v.confirm, { path: ["confirm"], message: "Passwords don't match." });

export type FieldErrors<K extends string> = Partial<Record<K, string>>;

/** First message per top-level field. */
export function fieldErrors<K extends string>(error: ZodError): FieldErrors<K> {
  const out: FieldErrors<K> = {};
  for (const issue of error.issues) {
    const key = issue.path[0];
    if (typeof key === "string" && !(key in out)) out[key as K] = issue.message;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Supabase error mapping (never echoes server messages that could reveal accounts)
// ---------------------------------------------------------------------------

type MaybeAuthError = { name?: string; status?: number; code?: string } | null | undefined;

export const MESSAGES = {
  invalidCredentials: "Email or password is incorrect.",
  network: "We couldn't reach the sign-in service. Check your connection and try again.",
  rateLimited: "Too many attempts. Wait a minute, then try again.",
  generic: "Something went wrong. Please try again.",
} as const;

export function isNetworkError(err: unknown): boolean {
  const e = err as MaybeAuthError;
  if (err instanceof TypeError) return true;
  return e?.name === "AuthRetryableFetchError" || e?.status === 0;
}

export function isRateLimited(err: unknown): boolean {
  const e = err as MaybeAuthError;
  return e?.status === 429 || (typeof e?.code === "string" && e.code.startsWith("over_"));
}

export function authErrorCode(err: unknown): string | undefined {
  const code = (err as MaybeAuthError)?.code;
  return typeof code === "string" ? code : undefined;
}

/** Reads a Supabase redirect error (`error_description` in the query or hash), if any. */
export function redirectErrorFromUrl(search: URLSearchParams): string | null {
  const fromQuery = search.get("error_code") ?? search.get("error");
  if (fromQuery) return fromQuery;
  if (typeof window === "undefined" || !window.location.hash) return null;
  const hash = new URLSearchParams(window.location.hash.slice(1));
  return hash.get("error_code") ?? hash.get("error");
}

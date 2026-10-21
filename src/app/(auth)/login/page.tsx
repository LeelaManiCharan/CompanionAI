import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardFallback } from "@/components/auth/AuthCardFallback";
import { LoginForm } from "@/components/auth/LoginForm";

export const metadata: Metadata = { title: "Sign in · Companion" };

export default function LoginPage() {
  return (
    <Suspense fallback={<AuthCardFallback />}>
      <LoginForm />
    </Suspense>
  );
}

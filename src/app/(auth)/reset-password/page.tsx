import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthCardFallback } from "@/components/auth/AuthCardFallback";
import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";

export const metadata: Metadata = { title: "Reset password · Companion" };

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<AuthCardFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}

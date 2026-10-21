import type { Metadata } from "next";
import { SignupForm } from "@/components/auth/SignupForm";

export const metadata: Metadata = { title: "Create account · Companion" };

export default function SignupPage() {
  return <SignupForm />;
}

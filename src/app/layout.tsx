import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppRoot } from "@/components/app/AppRoot";
import { PrivacyNoticeDialog } from "@/components/app/PrivacyNoticeDialog";
import { SafetyProvider } from "@/components/app/SafetyProvider";
import { AuthProvider } from "@/components/auth/AuthProvider";
import { SetupRequired } from "@/components/auth/SetupRequired";
import { ToastProvider } from "@/components/ui/Toast";
import { getSupabaseEnv, isSupabaseEnvMissing } from "@/lib/supabase/env";
import "./globals.css";

export const metadata: Metadata = {
  title: "Companion · Daily check-ins",
  description: "A private, local-first AI companion for daily check-ins.",
};

export const viewport: Viewport = {
  themeColor: "#14532D",
};

/*
 * Provider order: SafetyProvider sits outside AppRoot so the Crisis_Resources
 * and Help control work on every screen (including onboarding) and survive
 * Profile switches; the privacy gate is mounted once for the whole session.
 * AuthProvider wraps AppRoot so the Local_Store opens only after sign-in.
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  // Missing Supabase config: every route shows the Setup_Screen instead (22.9).
  const env = getSupabaseEnv();
  if (isSupabaseEnvMissing(env)) {
    return (
      <html
        lang="en"
        className={`${GeistSans.variable} ${GeistMono.variable}`}
        suppressHydrationWarning
      >
        <body suppressHydrationWarning>
          <SetupRequired missing={env.missing} />
        </body>
      </html>
    );
  }

  return (
    // suppressHydrationWarning on <html>/<body>: browser extensions (e.g. a
    // corporate security script) inject attributes before hydration. This
    // only silences attribute mismatches on these two elements, not children.
    <html
      lang="en"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>
        <ToastProvider>
          <SafetyProvider>
            <AuthProvider>
              <AppRoot>{children}</AppRoot>
            </AuthProvider>
            <PrivacyNoticeDialog />
          </SafetyProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

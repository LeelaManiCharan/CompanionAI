import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { AppRoot } from "@/components/app/AppRoot";
import { PrivacyNoticeDialog } from "@/components/app/PrivacyNoticeDialog";
import { SafetyProvider } from "@/components/app/SafetyProvider";
import { ToastProvider } from "@/components/ui/Toast";
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
 */
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body>
        <ToastProvider>
          <SafetyProvider>
            <AppRoot>{children}</AppRoot>
            <PrivacyNoticeDialog />
          </SafetyProvider>
        </ToastProvider>
      </body>
    </html>
  );
}

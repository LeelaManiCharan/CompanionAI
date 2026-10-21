"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { CheckInPromptBanner } from "@/components/home/CheckInPromptBanner";
import { useCallElsewhere } from "@/services/useTabState";
import { cn } from "@/lib/cn";
import { AiDisclaimer } from "./AiDisclaimer";
import { AppNotices } from "./AppNotices";
import { useOptionalApp } from "./appContext";
import { Wordmark } from "./BrandMark";
import { HelpButton } from "./HelpButton";
import { ProviderBadge } from "./ProviderBadge";

const NAV = [
  { href: "/", label: "Home" },
  { href: "/chat", label: "Chat" },
  { href: "/memories", label: "Memories" },
  { href: "/settings", label: "Settings" },
] as const;

const WIDTHS = {
  narrow: "max-w-3xl",
  default: "max-w-6xl",
} as const;

export type AppShellProps = {
  children: ReactNode;
  /** Content width. The top bar always spans the default width. */
  width?: keyof typeof WIDTHS;
  /** Classes for the `<main>` element (e.g. to remove padding on full-height pages). */
  mainClassName?: string;
  /** Hide the disclaimer footer (pages that render the disclaimer themselves). */
  hideFooter?: boolean;
};

function isActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Page chrome used by every page except `/call` (which is full-screen): top
 * bar with wordmark, navigation, Provider_Badge, profile switcher and Help,
 * app notices, and the persistent AI disclaimer (6.7, 14.5, 15.3).
 */
export function AppShell({ children, width = "default", mainClassName, hideFooter = false }: AppShellProps) {
  const pathname = usePathname() ?? "/";
  const profile = useOptionalApp()?.activeProfile ?? null;
  const initial = profile?.displayName.trim().charAt(0).toUpperCase() || "?";
  const callElsewhere = useCallElsewhere();

  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-md focus:bg-bg focus:px-3 focus:py-2 focus:text-sm focus:shadow-card"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-30 border-b border-border/80 glass-panel supports-[backdrop-filter]:bg-bg/70">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link href="/" aria-label="Companion home" className="-ml-1 rounded-md px-1 py-1">
            <Wordmark />
          </Link>

          <nav aria-label="Main" className="ml-6 hidden md:block">
            <ul className="flex items-center gap-1">
              {NAV.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={cn(
                        "relative inline-flex h-9 items-center rounded-md px-3 text-sm tracking-[-0.01em] transition-colors duration-150",
                        active
                          ? "font-medium text-text after:absolute after:inset-x-3 after:-bottom-[11px] after:h-0.5 after:rounded-full after:bg-gradient-brand"
                          : "text-muted hover:bg-surface hover:text-text",
                      )}
                    >
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="ml-auto flex items-center gap-2 sm:gap-2.5">
            <ProviderBadge />
            {profile ? (
              <Link
                href="/profiles"
                title="Switch profile"
                className="group inline-flex h-9 items-center gap-2 rounded-md px-1.5 text-sm text-text transition-colors hover:bg-surface sm:pr-2.5"
              >
                <span
                  aria-hidden="true"
                  className="inline-flex size-7 items-center justify-center rounded-full bg-gradient-brand text-[13px] font-semibold text-white shadow-glow transition-transform duration-200 group-hover:scale-105"
                >
                  {initial}
                </span>
                <span className="hidden max-w-[10rem] truncate font-medium tracking-[-0.01em] lg:inline">
                  {profile.displayName}
                </span>
                <span className="sr-only">: switch profile</span>
              </Link>
            ) : null}
            <HelpButton />
            <SignOutButton className="-mr-1" />
          </div>
        </div>

        <nav aria-label="Main" className="border-t border-border md:hidden">
          <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 py-1.5">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex h-8 items-center justify-center rounded-md px-3 text-[13px] transition-all duration-200",
                      active
                        ? "bg-gradient-brand font-medium text-white shadow-glow"
                        : "text-muted hover:bg-surface hover:text-text",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>

      <main
        id="main"
        tabIndex={-1}
        className={cn("mx-auto w-full flex-1 px-4 py-8 outline-none sm:px-6 sm:py-10", WIDTHS[width], mainClassName)}
      >
        {/* Incoming calls (reminders 24.6, Daily_Check_Ins 12.6) ring at the top of every page. */}
        <CheckInPromptBanner callElsewhere={callElsewhere} />
        <AppNotices className="mb-6" />
        {children}
      </main>

      {hideFooter ? null : (
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <AiDisclaimer />
            <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Stored on this device</p>
          </div>
        </footer>
      )}
    </div>
  );
}

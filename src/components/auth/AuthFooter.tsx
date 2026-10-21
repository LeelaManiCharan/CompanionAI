"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSafety } from "@/components/app/SafetyProvider";
import { cn } from "@/lib/cn";

const LINKS = [
  { href: "/login", label: "Sign in" },
  { href: "/signup", label: "Create account" },
  { href: "/reset-password", label: "Reset password" },
] as const;

const linkClass = "rounded-sm px-1 py-0.5 transition-colors hover:text-text";

/** Quiet footer for the auth pages: page links, crisis resources, and the AI disclaimer. */
export function AuthFooter() {
  const pathname = usePathname() ?? "";
  const { showCrisis } = useSafety();

  return (
    <footer className="px-4 pb-8 pt-2">
      <div className="mx-auto flex max-w-[420px] flex-col items-center gap-3 text-center">
        <nav aria-label="Account pages">
          <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-[13px] text-muted">
            {LINKS.filter((l) => l.href !== pathname).map((l) => (
              <li key={l.href}>
                <Link href={l.href} className={linkClass}>
                  {l.label}
                </Link>
              </li>
            ))}
            <li>
              <button type="button" onClick={showCrisis} aria-haspopup="dialog" className={cn(linkClass, "text-danger/90")}>
                Crisis resources
              </button>
            </li>
          </ul>
        </nav>
        <p className="max-w-xs text-[12px] leading-5 text-muted/90">
          Companion is an AI, not a therapist or a substitute for professional help.
        </p>
      </div>
    </footer>
  );
}

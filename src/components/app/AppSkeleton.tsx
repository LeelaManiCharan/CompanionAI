"use client";

import { usePathname } from "next/navigation";
import { Skeleton } from "@/components/ui";
import { cn } from "@/lib/cn";
import { Wordmark } from "./BrandMark";

/** Placeholder block with explicit size and radius (no class conflicts with Skeleton defaults). */
function Bone({ className }: { className: string }) {
  return <div aria-hidden="true" className={cn("animate-pulse bg-surface-2/70", className)} />;
}

/**
 * Static placeholder shown until the Local_Store is open and the Active_Profile
 * is loaded. Depends only on the pathname, so server and client render the same
 * markup (no hydration mismatch, no IndexedDB access during SSR).
 */
export function AppSkeleton() {
  const pathname = usePathname() ?? "/";

  if (pathname.startsWith("/call")) {
    return (
      <div aria-busy="true" className="fixed inset-0 flex items-center justify-center bg-primary-deep">
        <span className="sr-only">Loading</span>
        <div aria-hidden="true" className="size-28 animate-pulse rounded-full bg-white/10" />
      </div>
    );
  }

  return (
    <div aria-busy="true" className="flex min-h-dvh flex-col bg-bg">
      <span className="sr-only">Loading</span>
      <header className="border-b border-border bg-bg">
        <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <Wordmark />
          <div className="flex items-center gap-2">
            <Bone className="hidden h-[22px] w-28 rounded-sm sm:block" />
            <Bone className="size-8 rounded-full" />
            <Bone className="h-9 w-[72px] rounded-md" />
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-10 sm:px-6">
        <Bone className="h-7 w-56 rounded-sm" />
        <Bone className="mt-3 h-4 w-80 max-w-full rounded-sm" />
        <div className="mt-8 grid gap-4 md:grid-cols-[1.4fr_1fr]">
          <div className="rounded-lg border border-border p-5">
            <Bone className="h-[22px] w-32 rounded-sm" />
            <Skeleton lines={3} className="mt-5" />
            <div className="mt-6 flex gap-2">
              <Bone className="h-11 w-32 rounded-md" />
              <Bone className="h-11 w-28 rounded-md" />
            </div>
          </div>
          <div className="rounded-lg border border-border p-5">
            <Bone className="h-4 w-24 rounded-sm" />
            <Skeleton lines={2} className="mt-5" />
          </div>
        </div>
      </main>
    </div>
  );
}

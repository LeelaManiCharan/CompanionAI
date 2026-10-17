"use client";

import type { ReactNode } from "react";
import { AiDisclaimer, AppShell } from "@/components/app";
import { cn } from "@/lib/cn";
import { ChatRail, type ChatRailProps } from "./ChatRail";

export type ChatLayoutProps = {
  children: ReactNode;
  rail?: Omit<ChatRailProps, "className">;
  /** Below 1024 px only one column shows: the rail or the conversation. */
  mobileView: "rail" | "conversation";
};

/**
 * Two columns at ≥ 1024 px (sticky chat rail + conversation), one column
 * below. The page scrolls as a whole so the composer can stay sticky at the
 * bottom; the AI disclaimer sits under the composer instead of the footer.
 */
export function ChatLayout({ children, rail, mobileView }: ChatLayoutProps) {
  return (
    <AppShell hideFooter>
      <div className="lg:grid lg:grid-cols-[272px_minmax(0,1fr)] lg:gap-8">
        <ChatRail
          {...rail}
          className={cn(
            mobileView === "rail" ? "flex" : "hidden lg:flex",
            "lg:sticky lg:top-[calc(3.5rem+2.5rem)] lg:max-h-[calc(100dvh-3.5rem-5rem)] lg:self-start",
            "lg:border-r lg:border-border lg:pr-6",
          )}
        />
        <section
          className={cn(
            "min-w-0 flex-col",
            mobileView === "conversation" ? "flex" : "hidden lg:flex",
            "min-h-[calc(100dvh-3.5rem-5rem)]",
          )}
        >
          {children}
        </section>
      </div>
      {mobileView === "rail" ? <AiDisclaimer className="mt-8 lg:hidden" /> : null}
    </AppShell>
  );
}

/** Sticky bottom area: composer + persistent AI disclaimer (14.5, 15.3). */
export function ComposerDock({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-1 mt-auto bg-bg px-1 pb-4 pt-3 sm:pb-5">
      {children}
      <AiDisclaimer className="mt-2 px-1 text-center text-[12px]" />
    </div>
  );
}

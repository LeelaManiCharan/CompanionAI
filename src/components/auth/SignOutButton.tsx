"use client";

import { useState } from "react";
import { IconLogOut, Spinner } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useOptionalAuth } from "./AuthProvider";

/** Compact sign-out control for the top bar (22.4). Renders nothing when signed out. */
export function SignOutButton({ className }: { className?: string }) {
  const auth = useOptionalAuth();
  const [busy, setBusy] = useState(false);
  if (!auth || auth.status !== "signed_in") return null;

  const label = auth.user?.email ? `Sign out (${auth.user.email})` : "Sign out";

  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await auth.signOut();
    } catch {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      aria-label={label}
      title={label}
      aria-busy={busy || undefined}
      disabled={busy}
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-md border border-transparent text-muted transition-colors duration-150",
        "hover:bg-surface hover:text-text active:bg-surface-2 disabled:opacity-60",
        className,
      )}
    >
      {busy ? <Spinner size={16} /> : <IconLogOut size={17} />}
    </button>
  );
}

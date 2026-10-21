"use client";

import { useState } from "react";
import { signupDisplayName, useAuth } from "@/components/auth/AuthProvider";
import { useCallActive } from "@/components/backup/hooks";
import { Button, IconLogOut } from "@/components/ui";
import { SettingsRow, SettingsSection } from "./SettingsSection";

/** Signed-in account (Req 22.4): email and the sign-out control. */
export function AccountSection({ index }: { index: string }) {
  const { user, signOut } = useAuth();
  const callActive = useCallActive();
  const [busy, setBusy] = useState(false);

  const email = user?.email ?? "";
  const name = signupDisplayName(user);
  const initial = (name ?? email).trim().charAt(0).toUpperCase() || "?";

  const onSignOut = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await signOut();
    } catch {
      setBusy(false);
    }
  };

  return (
    <SettingsSection
      id="account"
      index={index}
      title="Account"
      description="Your sign-in for this app. Profiles and chats on this device belong to this account."
    >
      <SettingsRow className="flex items-center gap-4">
        <span
          aria-hidden="true"
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-brand text-[15px] font-semibold text-white shadow-glow"
        >
          {initial}
        </span>
        <dl className="min-w-0 flex-1">
          {name ? (
            <>
              <dt className="sr-only">Name</dt>
              <dd className="truncate text-sm font-medium text-text">{name}</dd>
            </>
          ) : null}
          <dt className="sr-only">Email</dt>
          <dd className={name ? "truncate text-[13px] text-muted" : "truncate text-sm font-medium text-text"}>
            {email || "Signed in"}
          </dd>
        </dl>
      </SettingsRow>
      <SettingsRow className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">Sign out</p>
          <p className="mt-0.5 text-[13px] leading-5 text-muted">
            {callActive
              ? "Ends the current call and saves its transcript first. Your data stays on this device for your next sign-in."
              : "Your data stays on this device and comes back when you sign in again."}
          </p>
        </div>
        <Button
          variant="secondary"
          leadingIcon={<IconLogOut size={16} />}
          loading={busy}
          onClick={() => void onSignOut()}
        >
          {busy ? "Signing out…" : "Sign out"}
        </Button>
      </SettingsRow>
    </SettingsSection>
  );
}

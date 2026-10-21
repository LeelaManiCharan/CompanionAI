"use client";

import { useEffect } from "react";
import { AppShell, useActiveProfile } from "@/components/app";
import {
  AccountSection,
  ActivitySection,
  CheckInsSection,
  CloudBackupSection,
  CompanionSection,
  DangerZoneSection,
  ModelSection,
  SettingsNav,
  type SettingsNavItem,
} from "@/components/settings";
import { Reveal } from "@/components/ui";

const SECTIONS: SettingsNavItem[] = [
  { id: "companion", label: "Companion" },
  { id: "model", label: "Model" },
  { id: "check-ins", label: "Check-ins" },
  { id: "activity", label: "Activity" },
  { id: "cloud-backup", label: "Cloud backup" },
  { id: "account", label: "Account" },
  { id: "danger-zone", label: "Danger zone" },
];

const pad = (i: number) => String(i + 1).padStart(2, "0");

/** Settings (design "UI design system and pages"; Req 2, 6, 7, 10.7, 11.4, 12.4, 12.5, 13, 18). */
export default function SettingsPage() {
  return (
    <AppShell>
      <SettingsContent />
    </AppShell>
  );
}

function SettingsContent() {
  const profile = useActiveProfile();

  // Pages render after AppRoot boots, so the browser's initial hash jump has
  // already happened against the skeleton; redo it once the sections exist.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (id) document.getElementById(id)?.scrollIntoView({ block: "start" });
  }, []);

  return (
    <>
      <header className="mb-8 flex flex-col gap-1 border-b border-border pb-6 sm:mb-10">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-gradient-brand">Settings</p>
        <h1 className="text-[28px] leading-[1.2] tracking-[-0.03em] text-text">Make it yours</h1>
        <p className="text-sm text-muted">
          Settings for <span className="font-medium text-text">{profile.displayName}</span>, saved on this device.
          Cloud backup is shared by every profile in this browser.
        </p>
      </header>

      <div className="lg:grid lg:grid-cols-[180px_minmax(0,1fr)] lg:gap-12">
        <SettingsNav items={SECTIONS} />
        {/* Remount per profile so drafts never carry over between profiles. */}
        <div key={profile.id} className="flex min-w-0 flex-col gap-12">
          <Reveal>
            <CompanionSection index={pad(0)} />
          </Reveal>
          <Reveal>
            <ModelSection index={pad(1)} />
          </Reveal>
          <Reveal>
            <CheckInsSection index={pad(2)} />
          </Reveal>
          <Reveal>
            <ActivitySection index={pad(3)} />
          </Reveal>
          <Reveal>
            <CloudBackupSection index={pad(4)} />
          </Reveal>
          <Reveal>
            <AccountSection index={pad(5)} />
          </Reveal>
          <Reveal>
            <DangerZoneSection index={pad(6)} />
          </Reveal>
        </div>
      </div>
    </>
  );
}

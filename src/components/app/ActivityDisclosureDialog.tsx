"use client";

import { useState } from "react";
import type { ActivityConsent } from "@/core/models";
import { Button, Dialog, IconActivity, InlineAlert } from "@/components/ui";
import { saveActivityConsent } from "@/services/settingsService";

const TRACKED = ["Session start time", "Session end time", "Session duration", "Page visited"] as const;

/**
 * Activity tracking disclosure (11.1, 11.7, 11.8). Shown for a Profile that has
 * not made a choice yet, before any Activity_Log is recorded. Opt in enables
 * tracking; opt out or dismissing disables it.
 */
export function ActivityDisclosureDialog({ profileId, open }: { profileId: string; open: boolean }) {
  const [busy, setBusy] = useState<ActivityConsent | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choose = async (choice: ActivityConsent) => {
    if (busy) return;
    setBusy(choice);
    setError(null);
    const res = await saveActivityConsent(choice, profileId);
    setBusy(null);
    // On success the live ProfileMeta update closes the dialog.
    if (!res.ok) setError(res.error);
  };

  return (
    <Dialog
      open={open}
      onClose={() => void choose("dismissed")}
      closeOnBackdrop={false}
      title="Help pick a good check-in time?"
      description="You can change this anytime in Settings."
      actions={
        <>
          <Button variant="secondary" loading={busy === "opt_out"} disabled={busy !== null && busy !== "opt_out"} onClick={() => void choose("opt_out")}>
            No thanks
          </Button>
          <Button variant="primary" loading={busy === "opt_in"} disabled={busy !== null && busy !== "opt_in"} onClick={() => void choose("opt_in")}>
            Turn on
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[15px] leading-6 text-text/90">
          Your companion can learn when you usually stop by and suggest your daily check-in around then. If you turn
          this on, the app keeps a private activity log that contains only:
        </p>
        <ul className="grid grid-cols-2 gap-2">
          {TRACKED.map((item) => (
            <li
              key={item}
              className="flex items-center gap-2 rounded-md border border-border bg-bg-subtle px-3 py-2 text-sm text-text"
            >
              <IconActivity size={15} className="shrink-0 text-primary" />
              {item}
            </li>
          ))}
        </ul>
        <p className="text-sm leading-5 text-muted">
          This data stays on this device and is used only for scheduling check-ins. Closing this without choosing
          keeps tracking off.
        </p>
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </div>
    </Dialog>
  );
}

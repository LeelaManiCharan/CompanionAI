"use client";

import { useState } from "react";
import { useCanWrite, useSettings } from "@/components/app";
import { ButtonLink, IconActivity, InlineAlert, Switch } from "@/components/ui";
import { saveActivityTracking } from "@/services/settingsService";
import { SettingsRow, SettingsSection } from "./SettingsSection";
import { usePendingValue } from "./usePendingValue";

/** Activity tracking toggle (Req 11.1, 11.4). Existing logs are kept when it changes. */
export function ActivitySection({ index }: { index: string }) {
  const settings = useSettings();
  const canWrite = useCanWrite();
  const [enabled, choose, revert] = usePendingValue(settings.activityTrackingEnabled);
  const [error, setError] = useState<string | null>(null);

  const change = async (next: boolean) => {
    if (!canWrite) return;
    setError(null);
    choose(next);
    const res = await saveActivityTracking(next);
    if (!res.ok) {
      revert();
      setError(res.error);
    }
  };

  return (
    <SettingsSection
      id="activity"
      index={index}
      title="Activity"
      description="Helps your companion pick a good time to check in."
    >
      <SettingsRow>
        <Switch
          label="Track activity"
          description="Records only when a session starts and ends, how long it lasted, and which page was open. Used only for scheduling check-ins."
          checked={enabled}
          onCheckedChange={(v) => void change(v)}
          disabled={!canWrite}
        />
        {error ? (
          <InlineAlert tone="danger" className="mt-3">
            {error}
          </InlineAlert>
        ) : null}
      </SettingsRow>
      <SettingsRow className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] leading-5 text-muted">
          Turning tracking off keeps what&apos;s already recorded. You can review or clear it any time.
        </p>
        <ButtonLink href="/activity" variant="secondary" leadingIcon={<IconActivity size={16} />}>
          View activity log
        </ButtonLink>
      </SettingsRow>
    </SettingsSection>
  );
}

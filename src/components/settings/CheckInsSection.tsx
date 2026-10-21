"use client";

import { useState, type FormEvent } from "react";
import { useActiveProfile, useCanWrite, useSettings } from "@/components/app";
import { Badge, Button, Field, InlineAlert, Skeleton, Switch, TextInput, useToast } from "@/components/ui";
import { validateCheckInTime } from "@/core/validators";
import { useLiveQuery } from "@/data/useLiveQuery";
import {
  isSupported,
  permission,
  registerServiceWorker,
  requestPermissionOnce,
  type NotificationPermissionState,
} from "@/services/notifications";
import { isRingtoneEnabled, primeAudio, setRingtoneEnabled } from "@/services/ringtone";
import { getPreferredTime } from "@/services/scheduler";
import { saveCheckInOverride, saveNotificationsEnabled } from "@/services/settingsService";
import { SettingsRow, SettingsSection } from "./SettingsSection";

const IN_APP_ONLY = "check-ins will appear only as in-app prompts";

function timeZoneName(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local time";
  } catch {
    return "local time";
  }
}

/** Preferred_Check_In_Time, override, and notifications (Req 12.4, 12.5, 13.1, 13.2, 13.6, 13.8). */
export function CheckInsSection({ index }: { index: string }) {
  const profile = useActiveProfile();
  const settings = useSettings();
  const canWrite = useCanWrite();
  const { toast } = useToast();

  const preferred = useLiveQuery(
    () => getPreferredTime(profile.id),
    ["settings", "activityLogs"],
    [profile.id, settings.checkInTimeOverride],
  );

  const [override, setOverride] = useState(settings.checkInTimeOverride ?? "");
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [saving, setSaving] = useState<"save" | "clear" | null>(null);

  const hasOverride = settings.checkInTimeOverride !== null;
  const dirty = override.trim() !== (settings.checkInTimeOverride ?? "");

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!canWrite || saving) return;
    const v = validateCheckInTime(override);
    if (!v.ok) {
      setOverrideError(v.error);
      return;
    }
    setSaving("save");
    const res = await saveCheckInOverride(v.value);
    setSaving(null);
    if (!res.ok) {
      setOverrideError(res.error);
      return;
    }
    toast({ title: `Check-ins set for ${v.value}`, tone: "success" });
  };

  const clear = async () => {
    if (!canWrite || saving) return;
    setSaving("clear");
    const res = await saveCheckInOverride(null);
    setSaving(null);
    if (!res.ok) {
      setOverrideError(res.error);
      return;
    }
    setOverride("");
    setOverrideError(null);
    toast({ title: "Using your activity to pick the time again" });
  };

  return (
    <SettingsSection
      id="check-ins"
      index={index}
      title="Check-ins"
      description="Your companion calls once a day around the time you're usually here."
    >
      <SettingsRow>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm text-muted">Preferred check-in time</p>
            <p className="mt-1 flex items-baseline gap-2">
              {preferred.data ? (
                <span className="font-mono text-[28px] font-medium leading-none tracking-[-0.02em] tabular-nums text-text">
                  {preferred.data}
                </span>
              ) : (
                <Skeleton className="h-7 w-20" />
              )}
              <span className="font-mono text-[12px] text-muted">{timeZoneName()}</span>
            </p>
          </div>
          {hasOverride ? <Badge tone="green">Set by you</Badge> : <Badge>From your activity</Badge>}
        </div>
        {!hasOverride ? (
          <p className="mt-3 text-[13px] leading-5 text-muted">
            Picked from the hour you most often open the app across your 14 most recent active days. Until there are 3
            days of activity (with tracking on), it&apos;s 19:00.
          </p>
        ) : null}
      </SettingsRow>

      <SettingsRow>
        <form onSubmit={save} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Field
            label="Override time"
            hint={overrideError ? undefined : "24-hour HH:MM. Clear it to go back to the automatic time."}
            error={overrideError}
            className="sm:w-56"
          >
            <TextInput
              mono
              type="time"
              step={60}
              value={override}
              disabled={!canWrite}
              onChange={(e) => {
                setOverride(e.target.value);
                setOverrideError(null);
              }}
            />
          </Field>
          <div className="flex gap-2 sm:mt-[30px]">
            <Button type="submit" loading={saving === "save"} disabled={!canWrite || !dirty || override.trim() === ""}>
              Save time
            </Button>
            <Button variant="ghost" loading={saving === "clear"} disabled={!canWrite || !hasOverride} onClick={clear}>
              Clear
            </Button>
          </div>
        </form>
      </SettingsRow>

      <SettingsRow>
        <NotificationsToggle />
      </SettingsRow>

      <SettingsRow>
        <RingtoneToggle />
      </SettingsRow>
    </SettingsSection>
  );
}

/** Ringtone for incoming calls; a per-browser preference (localStorage). */
function RingtoneToggle() {
  const [enabled, setEnabled] = useState(() => isRingtoneEnabled());
  return (
    <Switch
      label="Ringtone"
      description="Play a soft phone ring while a check-in or reminder call is waiting. Applies to this browser."
      checked={enabled}
      onCheckedChange={(v) => {
        setRingtoneEnabled(v);
        setEnabled(v);
        // The toggle click is a user gesture, so audio can be unlocked here.
        if (v) primeAudio();
      }}
    />
  );
}

function NotificationsToggle() {
  const settings = useSettings();
  const canWrite = useCanWrite();
  const supported = isSupported();
  const [perm, setPerm] = useState<NotificationPermissionState>(() => permission());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checked = supported && perm === "granted" && settings.notificationsEnabled;

  const onChange = (next: boolean) => {
    if (!canWrite || busy || !supported) return;
    setError(null);
    setMessage(null);

    if (!next) {
      setBusy(true);
      void saveNotificationsEnabled(false).then((res) => {
        setBusy(false);
        if (!res.ok) setError(res.error);
      });
      return;
    }

    // Must run synchronously inside the click handler (user gesture), 13.1.
    const request = requestPermissionOnce();
    setBusy(true);
    void request.then(async (result) => {
      setPerm(result);
      if (result === "granted") {
        const res = await saveNotificationsEnabled(true);
        if (!res.ok) setError(res.error);
        else void registerServiceWorker();
      } else {
        if (settings.notificationsEnabled) await saveNotificationsEnabled(false);
        setMessage(
          result === "denied"
            ? `Notifications are blocked for this site, so ${IN_APP_ONLY}.`
            : `Notifications weren't allowed, so ${IN_APP_ONLY}.`,
        );
      }
      setBusy(false);
    });
  };

  let note: string | null = null;
  if (!supported) note = `This browser doesn't support notifications, so ${IN_APP_ONLY}.`;
  else if (message) note = message;
  else if (perm === "denied")
    note = `Notifications are blocked for this site, so ${IN_APP_ONLY}. You can allow them in your browser's site settings.`;

  return (
    <div className="flex flex-col gap-3">
      <Switch
        label="Check-in notifications"
        description="Get a browser notification when your companion calls, even if this tab is in the background."
        checked={checked}
        onCheckedChange={onChange}
        disabled={!canWrite || !supported || busy}
        aria-busy={busy || undefined}
      />
      {note ? (
        <InlineAlert tone="info" role="status">
          {note.charAt(0).toUpperCase() + note.slice(1)}
        </InlineAlert>
      ) : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
    </div>
  );
}

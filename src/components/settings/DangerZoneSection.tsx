"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useActiveProfile, useCanWrite } from "@/components/app";
import { useCallActive } from "@/components/backup/hooks";
import { Button, Dialog, IconTrash, InlineAlert, useToast } from "@/components/ui";
import { resetProfile } from "@/services/chatDeletion";
import { deleteProfile } from "@/services/profileService";
import { SettingsRow, SettingsSection } from "./SettingsSection";

type Pending = null | "reset" | "delete";

/** Reset (10.7) and delete (1.4, 1.8) the Active_Profile. */
export function DangerZoneSection({ index }: { index: string }) {
  const profile = useActiveProfile();
  const canWrite = useCanWrite();
  const callActive = useCallActive();
  const router = useRouter();
  const { toast } = useToast();

  const [open, setOpen] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(null);
    setError(null);
  };

  const confirmReset = async () => {
    setBusy(true);
    setError(null);
    const res = await resetProfile(profile.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(null);
    toast({ title: "Profile reset", description: "Chats, memories, and the summary were removed.", tone: "success" });
  };

  const confirmDelete = async () => {
    setBusy(true);
    setError(null);
    const res = await deleteProfile(profile.id);
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    toast({ title: `Deleted ${profile.displayName}` });
    router.push("/");
  };

  return (
    <SettingsSection
      id="danger-zone"
      index={index}
      title="Danger zone"
      tone="danger"
      description="These actions can't be undone. Consider exporting a backup first."
    >
      <SettingsRow className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">Reset profile</p>
          <p className="mt-0.5 text-[13px] leading-5 text-muted">
            Deletes every chat, message, and memory for {profile.displayName}, and clears the profile summary. Settings
            stay.
          </p>
        </div>
        <Button variant="secondary" className="text-danger" disabled={!canWrite || callActive} onClick={() => setOpen("reset")}>
          Reset profile
        </Button>
      </SettingsRow>
      <SettingsRow className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-text">Delete profile</p>
          <p className="mt-0.5 text-[13px] leading-5 text-muted">
            Removes {profile.displayName} and all of its chats, memories, activity, and settings from this browser.
          </p>
        </div>
        <Button
          variant="danger"
          leadingIcon={<IconTrash size={16} />}
          disabled={!canWrite || callActive}
          onClick={() => setOpen("delete")}
        >
          Delete profile
        </Button>
      </SettingsRow>
      {callActive ? (
        <SettingsRow>
          <p className="text-[13px] text-muted">End the current call to reset or delete this profile.</p>
        </SettingsRow>
      ) : null}

      <Dialog
        open={open === "reset"}
        onClose={close}
        dismissible={!busy}
        tone="danger"
        title={`Reset ${profile.displayName}?`}
        description="All chats, messages, and memories for this profile are deleted, and the summary is cleared. The profile and its settings stay."
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirmReset()}>
              Reset profile
            </Button>
          </>
        }
      >
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </Dialog>

      <Dialog
        open={open === "delete"}
        onClose={close}
        dismissible={!busy}
        tone="danger"
        title={`Delete ${profile.displayName}?`}
        description="This profile and everything it owns are removed from this browser. Cloud backups are not affected."
        actions={
          <>
            <Button variant="ghost" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void confirmDelete()}>
              Delete {profile.displayName}
            </Button>
          </>
        }
      >
        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </Dialog>
    </SettingsSection>
  );
}

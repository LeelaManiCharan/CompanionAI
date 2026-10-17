"use client";

import { Badge } from "@/components/ui";
import { BackupPanel } from "@/components/backup/BackupPanel";
import { SettingsRow, SettingsSection } from "./SettingsSection";

/** Cloud backup settings and actions (Req 7, 18). Browser-level, not per profile. */
export function CloudBackupSection({ index }: { index: string }) {
  return (
    <SettingsSection
      id="cloud-backup"
      index={index}
      title="Cloud backup"
      description="Encrypted backups in your own Supabase Storage bucket, plus local file export and import."
      meta={<Badge>All profiles</Badge>}
    >
      <SettingsRow>
        <BackupPanel />
      </SettingsRow>
    </SettingsSection>
  );
}

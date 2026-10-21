"use client";

/**
 * Profiles page (Req 1.1–1.4, 1.7–1.9): up to 3 Profile cards with switch and
 * name-confirmed delete, plus the create form (disabled at the 3-Profile limit).
 */
import { useRouter } from "next/navigation";
import { useRef, useState, type FormEvent, type RefObject } from "react";
import { AppShell, useActiveProfile, useCanWrite } from "@/components/app";
import { formatDateTime, formatRelative } from "@/components/memories/format";
import {
  Badge,
  Button,
  Card,
  Dialog,
  Field,
  IconButton,
  IconPlus,
  IconTrash,
  IconUsers,
  InlineAlert,
  Reveal,
  Skeleton,
  TextInput,
  useToast,
} from "@/components/ui";
import type { Profile } from "@/core/models";
import { validateDisplayName } from "@/core/validators";
import { useLiveQuery, useRepo } from "@/data/useLiveQuery";
import { createProfile, deleteProfile, listProfiles, MAX_PROFILES, selectProfile } from "@/services/profileService";
import { endActiveCall } from "@/services/voice/useCallController";

const initialOf = (name: string) => name.trim().charAt(0).toUpperCase() || "?";

export default function ProfilesPage() {
  const router = useRouter();
  const active = useActiveProfile();
  const canWrite = useCanWrite();
  const repo = useRepo();
  const { toast } = useToast();
  const nameInputRef = useRef<HTMLInputElement>(null);

  const profilesQ = useLiveQuery(
    async () => {
      const res = await listProfiles();
      if (!res.ok) throw new Error(res.error);
      return res.value;
    },
    ["profiles"],
    [repo],
  );
  const profiles = profilesQ.data;
  const full = (profiles?.length ?? 0) >= MAX_PROFILES;

  const [switchingId, setSwitchingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Profile | null>(null);

  const switchTo = async (p: Profile) => {
    if (switchingId || !canWrite) return;
    setActionError(null);
    setSwitchingId(p.id);
    // End any call first so its transcript is saved to the Profile that started it (20.6).
    await endActiveCall().catch(() => undefined);
    const res = await selectProfile(p.id);
    setSwitchingId(null);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    toast({ title: `Switched to ${res.value.displayName}`, tone: "success" });
    router.push("/");
  };

  return (
    <AppShell width="narrow">
      <header className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-gradient-brand">Profiles</p>
        <h1 className="text-[28px] leading-tight tracking-[-0.03em] text-text">Who&apos;s checking in?</h1>
        <p className="max-w-xl text-muted">
          Up to {MAX_PROFILES} people can share this browser. Each profile has its own chats, memories, activity, and
          settings.
        </p>
      </header>

      {actionError ? (
        <InlineAlert tone="danger" className="mt-6" onDismiss={() => setActionError(null)}>
          {actionError}
        </InlineAlert>
      ) : null}

      <section aria-labelledby="profiles-title" className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="profiles-title" className="text-lg tracking-[-0.02em] text-text">
            Profiles on this device
          </h2>
          {profiles ? (
            <p className="font-mono text-[12px] tabular-nums text-muted">
              {profiles.length}/{MAX_PROFILES}
            </p>
          ) : null}
        </div>

        {profilesQ.loading && !profiles ? (
          <div aria-busy="true" className="mt-4 grid gap-3 sm:grid-cols-3">
            <span className="sr-only">Loading profiles</span>
            {[0, 1, 2].map((i) => (
              <Card key={i} className="p-5">
                <Skeleton className="h-11! w-11 rounded-full!" />
                <Skeleton className="mt-4 w-2/3" />
                <Skeleton className="mt-2 h-3! w-1/2" />
              </Card>
            ))}
          </div>
        ) : profilesQ.error && !profiles ? (
          <InlineAlert tone="danger" title="Profiles could not be loaded" className="mt-4">
            Your profiles were not changed. Try reloading the page.
          </InlineAlert>
        ) : (
          <ul className="mt-4 grid gap-3 sm:grid-cols-3">
            {(profiles ?? []).map((p, i) => (
              <Reveal key={p.id} as="li" delay={i * 60}>
                <ProfileCard
                  profile={p}
                  isActive={p.id === active.id}
                  canWrite={canWrite}
                  switching={switchingId === p.id}
                  switchDisabled={switchingId !== null}
                  onSwitch={() => void switchTo(p)}
                  onDelete={() => setPendingDelete(p)}
                />
              </Reveal>
            ))}
            {Array.from({ length: Math.max(0, MAX_PROFILES - (profiles?.length ?? 0)) }, (_, i) => (
              <li key={`slot-${i}`}>
                <button
                  type="button"
                  onClick={() => nameInputRef.current?.focus()}
                  disabled={!canWrite}
                  className="group flex h-full min-h-[184px] w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-bg-subtle text-sm text-muted transition-all duration-200 hover:border-primary/40 hover:text-primary disabled:pointer-events-none disabled:opacity-60"
                >
                  <span className="inline-flex size-9 items-center justify-center rounded-full border border-border bg-bg transition-all duration-200 group-hover:border-transparent group-hover:bg-gradient-brand group-hover:text-white group-hover:shadow-glow">
                    <IconPlus size={16} />
                  </span>
                  Open slot
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CreateProfileCard
        inputRef={nameInputRef}
        full={full}
        canWrite={canWrite}
        onCreated={(p) => {
          toast({ title: `Welcome, ${p.displayName}`, description: "Your new profile is now active.", tone: "success" });
          router.push("/");
        }}
      />

      <DeleteProfileDialog
        profile={pendingDelete}
        isActive={pendingDelete?.id === active.id}
        canWrite={canWrite}
        onClose={() => setPendingDelete(null)}
        onDeleted={(name) => {
          setPendingDelete(null);
          toast({ title: `${name} was deleted`, description: "All of that profile's data was removed." });
          router.push("/");
        }}
      />
    </AppShell>
  );
}

function ProfileCard({
  profile,
  isActive,
  canWrite,
  switching,
  switchDisabled,
  onSwitch,
  onDelete,
}: {
  profile: Profile;
  isActive: boolean;
  canWrite: boolean;
  switching: boolean;
  switchDisabled: boolean;
  onSwitch: () => void;
  onDelete: () => void;
}) {
  return (
    <Card
      aria-current={isActive ? "true" : undefined}
      className={
        "flex min-h-[184px] flex-col p-5 " + (isActive ? "border-primary/45! shadow-glow! ring-1 ring-primary/15" : "")
      }
    >
      <div className="flex items-start justify-between gap-2">
        <span
          aria-hidden="true"
          className="inline-flex size-11 items-center justify-center rounded-full bg-gradient-brand text-[17px] font-semibold text-white shadow-glow"
        >
          {initialOf(profile.displayName)}
        </span>
        {isActive ? (
          <Badge tone="green" dot>
            Active
          </Badge>
        ) : null}
      </div>

      <h3 className="mt-4 truncate text-[15px] font-semibold tracking-[-0.02em] text-text" title={profile.displayName}>
        {profile.displayName}
      </h3>
      <p className="mt-0.5 font-mono text-[12px] text-muted">
        Last used{" "}
        <time dateTime={profile.lastUsedAt} title={formatDateTime(profile.lastUsedAt)}>
          {formatRelative(profile.lastUsedAt)}
        </time>
      </p>

      <div className="mt-auto flex items-center gap-1.5 pt-5">
        {isActive ? (
          <p className="flex-1 text-[13px] text-muted">In use now</p>
        ) : (
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onSwitch}
            loading={switching}
            disabled={!canWrite || (switchDisabled && !switching)}
            aria-label={`Switch to ${profile.displayName}`}
          >
            Switch to
          </Button>
        )}
        <IconButton
          aria-label={`Delete ${profile.displayName}`}
          icon={<IconTrash size={16} />}
          onClick={onDelete}
          disabled={!canWrite}
          className="hover:text-danger!"
        />
      </div>
    </Card>
  );
}

function CreateProfileCard({
  inputRef,
  full,
  canWrite,
  onCreated,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  full: boolean;
  canWrite: boolean;
  onCreated: (p: Profile) => void;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const disabled = full || !canWrite;

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy || disabled) return;
    setFailure(null);
    const v = validateDisplayName(name);
    if (!v.ok) {
      // Keep the entered text so it can be corrected (1.7).
      setError(v.error);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    const res = await createProfile(name);
    setBusy(false);
    if (!res.ok) {
      setFailure(res.error);
      return;
    }
    setName("");
    onCreated(res.value);
  };

  return (
    <Reveal>
    <Card as="section" aria-labelledby="create-title" className="mt-10 overflow-hidden">
      <div className="flex items-start gap-3 px-5 pb-4 pt-5">
        <span
          aria-hidden="true"
          className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-gradient-brand text-white shadow-glow"
        >
          <IconUsers size={16} />
        </span>
        <div className="min-w-0">
          <h2 id="create-title" className="text-base tracking-[-0.02em] text-text">
            Add a profile
          </h2>
          <p className="mt-0.5 text-sm text-muted">The new profile starts fresh and becomes active right away.</p>
        </div>
      </div>

      <form onSubmit={submit} noValidate className="flex flex-col gap-4 px-5 py-5">
        {full ? (
          <InlineAlert tone="info" title="The limit is 3 Profiles">
            Delete a profile to make room for someone new.
          </InlineAlert>
        ) : null}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <Field
            label="Display name"
            hint={error ? undefined : "1 to 40 characters."}
            error={error}
            required
            className="flex-1"
          >
            <TextInput
              ref={inputRef}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (error) setError(null);
              }}
              autoComplete="off"
              placeholder="e.g. Sam"
              disabled={disabled}
            />
          </Field>
          <Button
            type="submit"
            loading={busy}
            disabled={disabled}
            leadingIcon={<IconPlus size={16} />}
            className="sm:mt-[29px]"
          >
            Create profile
          </Button>
        </div>
        {failure ? <InlineAlert tone="danger">{failure}</InlineAlert> : null}
      </form>
    </Card>
    </Reveal>
  );
}

function DeleteProfileDialog({
  profile,
  isActive,
  canWrite,
  onClose,
  onDeleted,
}: {
  profile: Profile | null;
  isActive: boolean;
  canWrite: boolean;
  onClose: () => void;
  onDeleted: (name: string) => void;
}) {
  return (
    <Dialog
      open={profile !== null}
      onClose={onClose}
      tone="danger"
      title={profile ? `Delete ${profile.displayName}?` : "Delete profile?"}
      description="This permanently removes the profile from this device. It can't be undone."
    >
      {/* Remount per Profile so the typed confirmation and errors reset. */}
      {profile ? (
        <DeleteProfileBody
          key={profile.id}
          profile={profile}
          isActive={isActive}
          canWrite={canWrite}
          onClose={onClose}
          onDeleted={onDeleted}
        />
      ) : null}
    </Dialog>
  );
}

function DeleteProfileBody({
  profile,
  isActive,
  canWrite,
  onClose,
  onDeleted,
}: {
  profile: Profile;
  isActive: boolean;
  canWrite: boolean;
  onClose: () => void;
  onDeleted: (name: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const matches = typed.trim() === profile.displayName;

  const confirm = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!matches || busy || !canWrite) return;
    setBusy(true);
    const res = await deleteProfile(profile.id);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    onDeleted(profile.displayName);
  };

  return (
    <form onSubmit={confirm} noValidate>
      <div className="rounded-md border border-danger/20 bg-danger/[0.04] px-3.5 py-3 text-sm leading-6">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-danger">Deleted with it</p>
        <p className="mt-1 text-text/85">
          All chats and messages, memories, the profile summary, activity history, check-ins, and settings of{" "}
          <strong className="font-semibold text-text">{profile.displayName}</strong>.
        </p>
        {isActive ? (
          <p className="mt-2 text-text/85">
            This is the active profile. Afterwards you&apos;ll switch to the most recently used one, or create a new
            profile if none remain.
          </p>
        ) : null}
      </div>

      <Field
        className="mt-4"
        label={
          <>
            Type <span className="font-mono text-[13px] font-semibold">{profile.displayName}</span> to confirm
          </>
        }
      >
        <TextInput
          value={typed}
          onChange={(e) => {
            setTyped(e.target.value);
            if (error) setError(null);
          }}
          autoComplete="off"
          spellCheck={false}
          autoFocus
          disabled={!canWrite}
        />
      </Field>

      {error ? (
        <InlineAlert tone="danger" className="mt-3">
          {error}
        </InlineAlert>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2 pt-5">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button type="submit" variant="danger" loading={busy} disabled={!matches || !canWrite}>
          Delete profile
        </Button>
      </div>
    </form>
  );
}

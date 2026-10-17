"use client";

import { useState, type FormEvent } from "react";
import { Badge, Button, Field, InlineAlert, TextInput, useToast } from "@/components/ui";
import { BackupNamespaceId, type BrowserRecord } from "@/core/models";
import { maskKey } from "@/core/secrets";
import {
  DEFAULT_BUCKET_NAME,
  validateApiKey,
  validateBucketName,
  validateSupabaseUrl,
} from "@/core/validators";
import { clearCloudStoreConfig, replaceNamespaceId, saveCloudStoreConfig, SETTINGS_ERRORS } from "@/services/settingsService";
import { CopyButton } from "@/components/settings/CopyableCode";

export const CLOUD_URL_INPUT_ID = "cloud-supabase-url";
const KEY_INPUT_ID = "cloud-anon-key";

/** Moves focus to the first Cloud_Store field (the "open cloud settings" link target). */
export function focusCloudSettings(): void {
  const el = document.getElementById(CLOUD_URL_INPUT_ID);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.focus({ preventScroll: true });
}

type FieldErrors = { url?: string; key?: string; bucket?: string; form?: string };

export type CloudConfigFormProps = {
  /** Live browser record. Drafts are seeded from it on mount, so mount once it has loaded. */
  record: BrowserRecord | null;
  disabled: boolean;
};

/**
 * Supabase project URL, anon key (masked once saved, with Replace / Clear),
 * and bucket (7.4–7.6, 7.10, 18.1). Shared by all profiles in this browser.
 */
export function CloudConfigForm({ record, disabled }: CloudConfigFormProps) {
  const { toast } = useToast();
  const saved = record?.cloudStoreConfig ?? null;
  const savedKey = saved?.supabaseAnonKey ?? "";

  const [url, setUrl] = useState(saved?.supabaseUrl ?? "");
  const [bucket, setBucket] = useState(saved?.bucketName ?? DEFAULT_BUCKET_NAME);
  const [key, setKey] = useState("");
  const [replacingKey, setReplacingKey] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [saving, setSaving] = useState(false);
  const [clearing, setClearing] = useState(false);

  const showKeyInput = savedKey === "" || replacingKey;
  const dirty =
    url.trim() !== (saved?.supabaseUrl ?? "") ||
    (bucket.trim() || DEFAULT_BUCKET_NAME) !== (saved?.bucketName ?? DEFAULT_BUCKET_NAME) ||
    key.trim() !== "";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (disabled || saving) return;
    const next: FieldErrors = {};
    const u = validateSupabaseUrl(url);
    if (!u.ok) next.url = u.error;
    const effectiveKey = showKeyInput ? key : savedKey;
    const k = validateApiKey(effectiveKey);
    if (!k.ok) next.key = effectiveKey.trim() === "" ? "Enter your Supabase anon key." : k.error;
    const b = validateBucketName(bucket.trim() === "" ? DEFAULT_BUCKET_NAME : bucket);
    if (!b.ok) next.bucket = b.error;
    setErrors(next);
    if (next.url || next.key || next.bucket) return;

    setSaving(true);
    const res = await saveCloudStoreConfig({ supabaseUrl: url, anonKey: effectiveKey, bucketName: bucket });
    setSaving(false);
    if (!res.ok) {
      setErrors({ form: res.error });
      return;
    }
    const cfg = res.value.cloudStoreConfig;
    setUrl(cfg?.supabaseUrl ?? url.trim());
    setBucket(cfg?.bucketName ?? DEFAULT_BUCKET_NAME);
    setKey("");
    setReplacingKey(false);
    toast({ title: "Cloud backup settings saved", tone: "success" });
  };

  const clearKey = async () => {
    if (disabled || clearing) return;
    setClearing(true);
    const res = await clearCloudStoreConfig();
    setClearing(false);
    if (!res.ok) {
      setErrors({ form: res.error });
      return;
    }
    setKey("");
    setReplacingKey(false);
    setErrors({});
    toast({ title: "Anon key cleared", description: "Enter a new key before the next backup or restore." });
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <Field
        id={CLOUD_URL_INPUT_ID}
        label="Supabase project URL"
        hint={errors.url ? undefined : "The https URL from your Supabase project's API settings."}
        error={errors.url}
        required
      >
        <TextInput
          mono
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://your-project.supabase.co"
          value={url}
          maxLength={2048}
          disabled={disabled}
          onChange={(e) => {
            setUrl(e.target.value);
            setErrors((x) => ({ ...x, url: undefined, form: undefined }));
          }}
        />
      </Field>

      {showKeyInput ? (
        <Field
          id={KEY_INPUT_ID}
          label="Supabase anon key"
          hint={
            errors.key
              ? undefined
              : "Stored only in this browser and sent only to your Supabase project. Shown masked after saving."
          }
          error={errors.key}
          required
        >
          <TextInput
            mono
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={replacingKey ? "Paste the new anon key" : "Paste your anon key"}
            value={key}
            maxLength={256}
            disabled={disabled}
            onChange={(e) => {
              setKey(e.target.value);
              setErrors((x) => ({ ...x, key: undefined, form: undefined }));
            }}
          />
        </Field>
      ) : (
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-text">Supabase anon key</span>
          <div className="flex flex-wrap items-center gap-2">
            <code
              aria-label="Saved anon key, masked"
              className="min-w-0 flex-1 truncate rounded-md border border-border bg-bg-subtle px-3 py-2 font-mono text-[13px] tracking-[0.04em] text-text"
            >
              {maskKey(savedKey)}
            </code>
            <Button variant="secondary" disabled={disabled} onClick={() => setReplacingKey(true)}>
              Replace
            </Button>
            <Button variant="ghost" disabled={disabled} loading={clearing} onClick={clearKey} className="text-danger">
              Clear
            </Button>
          </div>
          <p className="text-[13px] leading-5 text-muted">Only the last 4 characters are shown.</p>
        </div>
      )}

      <Field
        label="Storage bucket"
        hint={errors.bucket ? undefined : `Lowercase letters, digits, and hyphens. Default ${DEFAULT_BUCKET_NAME}.`}
        error={errors.bucket}
      >
        <TextInput
          mono
          autoComplete="off"
          spellCheck={false}
          placeholder={DEFAULT_BUCKET_NAME}
          value={bucket}
          maxLength={63}
          disabled={disabled}
          onChange={(e) => {
            setBucket(e.target.value);
            setErrors((x) => ({ ...x, bucket: undefined, form: undefined }));
          }}
        />
      </Field>

      {errors.form ? <InlineAlert tone="danger">{errors.form}</InlineAlert> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" loading={saving} disabled={disabled || (!dirty && !showKeyInput)}>
          Save cloud settings
        </Button>
        {replacingKey ? (
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => {
              setReplacingKey(false);
              setKey("");
              setErrors((x) => ({ ...x, key: undefined }));
            }}
          >
            Keep current key
          </Button>
        ) : null}
        <span className="ml-auto">
          {saved && savedKey ? (
            <Badge tone="green" dot>
              Configured
            </Badge>
          ) : (
            <Badge tone="neutral" dot>
              {saved ? "No key" : "Not configured"}
            </Badge>
          )}
        </span>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Backup_Namespace_ID (18.14)
// ---------------------------------------------------------------------------

export function NamespaceIdRow({ namespaceId, disabled }: { namespaceId: string | null; disabled: boolean }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (disabled || saving) return;
    const v = BackupNamespaceId.safeParse(value.trim());
    if (!v.success) {
      setError(SETTINGS_ERRORS.namespaceId);
      return;
    }
    if (v.data === namespaceId) {
      setEditing(false);
      return;
    }
    setSaving(true);
    const res = await replaceNamespaceId(v.data);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setEditing(false);
    setValue("");
    toast({ title: "Namespace ID replaced", description: "Restore now lists backups made under this ID.", tone: "success" });
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-sm font-medium text-text">Backup namespace ID</span>
        <span className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted">Folder in your bucket</span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border border-border bg-bg-subtle px-3 py-2 font-mono text-[13px] leading-5 text-text">
          {namespaceId ?? "Loading…"}
        </code>
        {namespaceId ? <CopyButton text={namespaceId} label="Copy namespace ID" className="h-9" /> : null}
        {!editing ? (
          <Button variant="secondary" disabled={disabled || !namespaceId} onClick={() => setEditing(true)}>
            Replace
          </Button>
        ) : null}
      </div>
      <p className="text-[13px] leading-5 text-muted">
        To restore backups made in another browser, copy its namespace ID and paste it here.
      </p>

      {editing ? (
        <form onSubmit={save} noValidate className="mt-1 flex flex-col gap-3 rounded-md border border-border bg-bg-subtle p-3.5">
          <Field
            label="New namespace ID"
            hint={error ? undefined : "22 to 64 letters, digits, hyphens, or underscores. Copy the current ID first if you may need it again."}
            error={error}
            required
          >
            <TextInput
              mono
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={value}
              maxLength={64}
              disabled={disabled}
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="submit" loading={saving} disabled={disabled || value.trim() === ""}>
              Use this ID
            </Button>
            <Button
              variant="ghost"
              disabled={saving}
              onClick={() => {
                setEditing(false);
                setValue("");
                setError(null);
              }}
            >
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RLS / privacy notice (18.19)
// ---------------------------------------------------------------------------

export function CloudPrivacyNotice({ className }: { className?: string }) {
  return (
    <InlineAlert tone="info" role="note" title="How your backups are protected" className={className}>
      <ul className="mt-1 flex list-disc flex-col gap-1 pl-4">
        <li>
          Protect the bucket with Row Level Security storage policies that only allow reading and writing objects
          under your backup namespace ID prefix.
        </li>
        <li>
          This app has no user accounts, so access to the stored encrypted backups is protected only by the anon key
          and the namespace ID.
        </li>
        <li>Backup contents are protected by your passphrase, which never leaves this browser.</li>
      </ul>
    </InlineAlert>
  );
}

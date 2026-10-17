"use client";

/**
 * Memories page (Req 8.6–8.8, 9.7, 9.8, 10.7): the Profile_Summary editor, a
 * category-filtered, newest-first list of Memories with inline edit and
 * confirmed delete, and the "Forget everything" Profile reset.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { AppShell, useActiveProfile, useCanWrite, useSettings } from "@/components/app";
import { CountedTextarea } from "@/components/memories/CountedTextarea";
import { formatDateTime, formatRelative } from "@/components/memories/format";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  Dialog,
  EmptyState,
  IconButton,
  IconMemory,
  IconMessage,
  IconTrash,
  InlineAlert,
  SegmentedControl,
  Select,
  Skeleton,
  useToast,
  type SegmentedOption,
} from "@/components/ui";
import type { Memory, MemoryCategory } from "@/core/models";
import { LIMITS } from "@/core/validators";
import { useLiveQuery, useRepo } from "@/data/useLiveQuery";
import { resetProfile } from "@/services/chatDeletion";
import { deleteMemory, saveSummary, updateMemory } from "@/services/memoryService";

const CATEGORIES: { value: MemoryCategory; label: string }[] = [
  { value: "fact", label: "Fact" },
  { value: "mood", label: "Mood" },
  { value: "event", label: "Event" },
  { value: "person", label: "Person" },
];
const CATEGORY_LABEL: Record<MemoryCategory, string> = { fact: "Fact", mood: "Mood", event: "Event", person: "Person" };

type Filter = "all" | MemoryCategory;

const byNewest = (a: Memory, b: Memory) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt);

export default function MemoriesPage() {
  const profile = useActiveProfile();
  const { botName } = useSettings();
  const canWrite = useCanWrite();
  const repo = useRepo();
  const profileId = profile.id;

  const memoriesQ = useLiveQuery(
    async () => (repo ? (await repo.memoriesByProfile(profileId)).sort(byNewest) : []),
    ["memories"],
    [repo, profileId],
  );
  const count = memoriesQ.data?.length;

  return (
    <AppShell width="narrow">
      <header className="flex flex-col gap-1.5">
        <p className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Memories</p>
        <h1 className="text-[28px] leading-tight tracking-[-0.03em] text-text">What {botName} remembers</h1>
        <p className="max-w-xl text-muted">
          Things {botName} picked up from your chats with {profile.displayName}. Everything here stays on this device,
          and you can change or remove any of it.
        </p>
      </header>

      <div className="mt-8 flex flex-col gap-10">
        <SummaryCard profileId={profileId} botName={botName} canWrite={canWrite} />

        <section aria-labelledby="memories-title">
          <div className="flex items-baseline justify-between gap-3">
            <h2 id="memories-title" className="text-lg tracking-[-0.02em] text-text">
              Memories
            </h2>
            {count !== undefined ? (
              <p className="font-mono text-[12px] tabular-nums text-muted">
                {count} {count === 1 ? "memory" : "memories"}
              </p>
            ) : null}
          </div>
          <div className="mt-4">
            <MemoryList
              memories={memoriesQ.data}
              loading={memoriesQ.loading && !memoriesQ.data}
              failed={Boolean(memoriesQ.error) && !memoriesQ.data}
              botName={botName}
              canWrite={canWrite}
            />
          </div>
        </section>

        <ForgetEverything profileId={profileId} profileName={profile.displayName} botName={botName} canWrite={canWrite} />
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------
// Profile_Summary editor (9.7, 9.8)
// ---------------------------------------------------------------------------

function SummaryCard({ profileId, botName, canWrite }: { profileId: string; botName: string; canWrite: boolean }) {
  const repo = useRepo();
  const { toast } = useToast();
  const summaryQ = useLiveQuery(
    async () => (repo ? ((await repo.getSummary(profileId)) ?? null) : null),
    ["summaries"],
    [repo, profileId],
  );
  const stored = summaryQ.data?.content ?? "";
  // null = showing the stored summary; a string = the user's unsaved edit (kept on errors, 9.8).
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const value = draft ?? stored;
  const dirty = draft !== null && draft !== stored;
  const loading = summaryQ.loading && summaryQ.data === undefined;

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!dirty || saving || !canWrite) return;
    setSaving(true);
    const res = await saveSummary(profileId, value);
    setSaving(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setDraft(null);
    toast({ title: "Summary saved", description: `${botName} will use it in your next conversation.`, tone: "success" });
  };

  const discard = () => {
    setDraft(null);
    setError(null);
  };

  return (
    <Card as="section" aria-labelledby="summary-title" className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border bg-bg-subtle px-5 py-4">
        <div className="min-w-0">
          <h2 id="summary-title" className="text-base tracking-[-0.02em] text-text">
            Profile summary
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            A short note {botName} reads before every conversation. It refreshes after chats, and you can rewrite it
            anytime.
          </p>
        </div>
        {summaryQ.data?.updatedAt && stored ? (
          <p className="shrink-0 font-mono text-[12px] text-muted" title={formatDateTime(summaryQ.data.updatedAt)}>
            Updated {formatRelative(summaryQ.data.updatedAt)}
          </p>
        ) : null}
      </div>

      <form onSubmit={save} noValidate className="px-5 pb-5 pt-4">
        {loading ? (
          <div aria-busy="true" className="py-2">
            <span className="sr-only">Loading summary</span>
            <Skeleton lines={4} />
          </div>
        ) : summaryQ.error && summaryQ.data === undefined ? (
          <InlineAlert tone="danger" title="The summary could not be loaded">
            Your stored summary was not changed. Try reloading the page.
          </InlineAlert>
        ) : (
          <>
            <CountedTextarea
              label="Profile summary"
              hideLabel
              value={value}
              max={LIMITS.summary.max}
              rows={6}
              error={error}
              disabled={!canWrite}
              placeholder={`Nothing here yet. After a few conversations, ${botName} will write a short summary of what matters to you.`}
              onChange={(e) => {
                setDraft(e.target.value);
                if (error) setError(null);
              }}
            />
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              {dirty ? (
                <Button variant="ghost" onClick={discard} disabled={saving}>
                  Discard changes
                </Button>
              ) : null}
              <Button type="submit" loading={saving} disabled={!dirty || !canWrite}>
                Save summary
              </Button>
            </div>
          </>
        )}
      </form>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Memory list (8.6–8.8)
// ---------------------------------------------------------------------------

function MemoryList({
  memories,
  loading,
  failed,
  botName,
  canWrite,
}: {
  memories: Memory[] | undefined;
  loading: boolean;
  failed: boolean;
  botName: string;
  canWrite: boolean;
}) {
  const { toast } = useToast();
  const [filter, setFilter] = useState<Filter>("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Memory | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const all = useMemo(() => memories ?? [], [memories]);
  const counts = useMemo(() => {
    const c: Record<MemoryCategory, number> = { fact: 0, mood: 0, event: 0, person: 0 };
    for (const m of all) c[m.category]++;
    return c;
  }, [all]);
  const visible = filter === "all" ? all : all.filter((m) => m.category === filter);

  // The edited Memory was removed elsewhere (another tab, chat deletion): leave edit mode.
  const editingGone = editingId !== null && memories !== undefined && !all.some((m) => m.id === editingId);
  useEffect(() => {
    if (editingGone) setEditingId(null);
  }, [editingGone]);

  const options: SegmentedOption<Filter>[] = [
    { value: "all", label: <FilterLabel text="All" count={all.length} /> },
    ...CATEGORIES.map((c) => ({ value: c.value, label: <FilterLabel text={c.label} count={counts[c.value]} /> })),
  ];

  const closeDelete = () => {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  };

  const confirmDelete = async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    const res = await deleteMemory(pendingDelete.id);
    setDeleting(false);
    if (!res.ok) {
      setDeleteError(res.error);
      return;
    }
    if (editingId === pendingDelete.id) setEditingId(null);
    setPendingDelete(null);
    setDeleteError(null);
    toast({ title: "Memory deleted", description: `${botName} won't bring it up again.` });
  };

  if (loading) {
    return (
      <div aria-busy="true" className="flex flex-col gap-3">
        <span className="sr-only">Loading memories</span>
        {[0, 1, 2].map((i) => (
          <Card key={i} className="p-5">
            <Skeleton className="h-[22px]! w-16" />
            <Skeleton lines={2} className="mt-3" />
          </Card>
        ))}
      </div>
    );
  }

  if (failed) {
    return (
      <InlineAlert tone="danger" title="Memories could not be loaded">
        Your stored memories were not changed. Try reloading the page.
      </InlineAlert>
    );
  }

  if (all.length === 0) {
    return (
      <EmptyState
        icon={<IconMemory size={18} />}
        title="No memories yet"
        description={`As you talk, ${botName} notes the facts, moods, events, and people you mention. They'll show up here, and you can edit or delete any of them.`}
        actions={
          <ButtonLink href="/chat" variant="secondary" leadingIcon={<IconMessage size={16} />}>
            Start a chat
          </ButtonLink>
        }
      />
    );
  }

  return (
    <>
      <SegmentedControl label="Filter by category" hideLabel options={options} value={filter} onChange={setFilter} />

      {visible.length === 0 ? (
        <EmptyState
          className="mt-4"
          title={`No ${CATEGORY_LABEL[filter as MemoryCategory].toLowerCase()} memories`}
          description="Try another category, or check back after your next chat."
          actions={
            <Button variant="secondary" onClick={() => setFilter("all")}>
              Show all
            </Button>
          }
        />
      ) : (
        <ul className="mt-4 flex flex-col gap-3" aria-label="Memories, newest first">
          {visible.map((m) => (
            <MemoryItem
              key={m.id}
              memory={m}
              editing={editingId === m.id}
              canWrite={canWrite}
              onEdit={() => setEditingId(m.id)}
              onDone={() => setEditingId(null)}
              onDelete={() => {
                setDeleteError(null);
                setPendingDelete(m);
              }}
            />
          ))}
        </ul>
      )}

      <Dialog
        open={pendingDelete !== null}
        onClose={closeDelete}
        tone="danger"
        size="sm"
        title="Delete this memory?"
        description={`${botName} will permanently forget it. This can't be undone.`}
        actions={
          <>
            <Button variant="secondary" onClick={closeDelete} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete} loading={deleting} disabled={!canWrite}>
              Delete memory
            </Button>
          </>
        }
      >
        {pendingDelete ? (
          <blockquote className="rounded-md border border-border bg-bg-subtle px-3.5 py-3 text-sm leading-6 text-text/85">
            <Badge className="mb-2">{CATEGORY_LABEL[pendingDelete.category]}</Badge>
            <p className="break-words">{pendingDelete.content}</p>
          </blockquote>
        ) : null}
        {deleteError ? (
          <InlineAlert tone="danger" className="mt-3">
            {deleteError}
          </InlineAlert>
        ) : null}
      </Dialog>
    </>
  );
}

function FilterLabel({ text, count }: { text: string; count: number }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {text}
      <span className="font-mono text-[11px] tabular-nums text-muted">{count}</span>
    </span>
  );
}

function MemoryItem({
  memory,
  editing,
  canWrite,
  onEdit,
  onDone,
  onDelete,
}: {
  memory: Memory;
  editing: boolean;
  canWrite: boolean;
  onEdit: () => void;
  onDone: () => void;
  onDelete: () => void;
}) {
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(editing);

  // Return focus to the Edit button when leaving edit mode.
  useEffect(() => {
    if (wasEditing.current && !editing) editButtonRef.current?.focus();
    wasEditing.current = editing;
  }, [editing]);

  return (
    <Card
      as="li"
      className={editing ? "border-primary/40! ring-1 ring-primary/15" : "transition-colors hover:border-muted/50!"}
    >
      {editing ? (
        <MemoryEditor memory={memory} canWrite={canWrite} onDone={onDone} />
      ) : (
        <div className="flex items-start gap-4 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Badge tone={memory.category === "mood" ? "green" : "neutral"}>{CATEGORY_LABEL[memory.category]}</Badge>
              <time
                dateTime={memory.updatedAt}
                title={formatDateTime(memory.updatedAt)}
                className="font-mono text-[12px] text-muted"
              >
                {formatRelative(memory.updatedAt)}
              </time>
            </div>
            <p className="mt-2 break-words text-[15px] leading-6 text-text">{memory.content}</p>
          </div>
          <div className="-mr-2 flex shrink-0 items-center gap-0.5">
            <Button ref={editButtonRef} variant="ghost" onClick={onEdit} disabled={!canWrite} aria-label="Edit memory">
              Edit
            </Button>
            <IconButton
              aria-label="Delete memory"
              icon={<IconTrash size={16} />}
              onClick={onDelete}
              disabled={!canWrite}
              className="hover:text-danger!"
            />
          </div>
        </div>
      )}
    </Card>
  );
}

function MemoryEditor({ memory, canWrite, onDone }: { memory: Memory; canWrite: boolean; onDone: () => void }) {
  const { toast } = useToast();
  const [content, setContent] = useState(memory.content);
  const [category, setCategory] = useState<MemoryCategory>(memory.category);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const changed = content !== memory.content || category !== memory.category;

  const save = async (e?: FormEvent<HTMLFormElement>) => {
    e?.preventDefault();
    if (saving || !canWrite) return;
    if (!changed) {
      onDone();
      return;
    }
    setSaving(true);
    const res = await updateMemory(memory.id, content, category);
    setSaving(false);
    if (!res.ok) {
      // Keep the edit open with the user's text (8.7).
      setError(res.error);
      return;
    }
    onDone();
    toast({ title: "Memory updated", tone: "success" });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Escape" && !saving) {
      e.preventDefault();
      onDone();
    } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void save();
    }
  };

  return (
    <form onSubmit={save} onKeyDown={onKeyDown} noValidate className="flex flex-col gap-4 px-5 py-4">
      <CountedTextarea
        label="Memory"
        value={content}
        max={LIMITS.memoryContent.max}
        rows={3}
        error={error}
        autoFocus
        disabled={!canWrite}
        onChange={(e) => {
          setContent(e.target.value);
          if (error) setError(null);
        }}
      />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-44">
          <label htmlFor={`category-${memory.id}`} className="mb-1.5 block text-sm font-medium text-text">
            Category
          </label>
          <Select
            id={`category-${memory.id}`}
            value={category}
            options={CATEGORIES}
            disabled={!canWrite}
            onChange={(e) => setCategory(e.target.value as MemoryCategory)}
          />
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden font-mono text-[11px] text-muted sm:inline">Esc to cancel</span>
          <Button variant="ghost" onClick={onDone} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" loading={saving} disabled={!canWrite}>
            Save
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Forget everything (10.7)
// ---------------------------------------------------------------------------

function ForgetEverything({
  profileId,
  profileName,
  botName,
  canWrite,
}: {
  profileId: string;
  profileName: string;
  botName: string;
  canWrite: boolean;
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (busy) return;
    setOpen(false);
    setError(null);
  };

  const confirm = async () => {
    if (busy) return;
    setBusy(true);
    const res = await resetProfile(profileId);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setOpen(false);
    setError(null);
    toast({ title: "Everything was forgotten", description: `${botName} is starting fresh. Your settings were kept.` });
  };

  return (
    <section
      aria-labelledby="forget-title"
      className="flex flex-col gap-4 rounded-lg border border-danger/25 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="min-w-0">
        <h2 id="forget-title" className="text-base tracking-[-0.02em] text-text">
          Forget everything
        </h2>
        <p className="mt-0.5 text-sm text-muted">
          Erase all chats, memories, and the summary for {profileName}. Settings stay as they are.
        </p>
      </div>
      <Button
        variant="secondary"
        className="border-danger/40! text-danger! hover:bg-danger/[0.05]!"
        onClick={() => setOpen(true)}
        disabled={!canWrite}
      >
        Forget everything
      </Button>

      <Dialog
        open={open}
        onClose={close}
        tone="danger"
        title={`Forget everything about ${profileName}?`}
        description="This can't be undone."
        actions={
          <>
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirm} loading={busy} disabled={!canWrite}>
              Forget everything
            </Button>
          </>
        }
      >
        <div className="grid gap-3 text-sm leading-6 sm:grid-cols-2">
          <div className="rounded-md border border-danger/20 bg-danger/[0.04] px-3.5 py-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-danger">Removed</p>
            <ul className="mt-1.5 list-disc pl-4 text-text/85">
              <li>All chats and messages</li>
              <li>All memories</li>
              <li>The profile summary</li>
            </ul>
          </div>
          <div className="rounded-md border border-border bg-bg-subtle px-3.5 py-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted">Kept</p>
            <ul className="mt-1.5 list-disc pl-4 text-text/85">
              <li>The profile itself</li>
              <li>{botName}&apos;s name, tone, and other settings</li>
              <li>Activity history</li>
            </ul>
          </div>
        </div>
        {error ? (
          <InlineAlert tone="danger" className="mt-3">
            {error}
          </InlineAlert>
        ) : null}
      </Dialog>
    </section>
  );
}

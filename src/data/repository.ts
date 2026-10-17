/**
 * Repository over the Local_Store (Req 16.1, 16.2, 16.4, 16.5, 19.10–19.12, 20.8).
 *
 * Every write goes through a single `readwrite` transaction that:
 * 1. evaluates the optional staleness guard (`isStale(op)`) before each write,
 * 2. validates the record with its zod model (19.10, 19.11),
 * 3. checks that profile-scoped records belong to `op.profileId` (20.8),
 * 4. checks referential integrity against the same transaction (19.12).
 *
 * Any failure (or any error thrown by the caller's `fn`) aborts the whole
 * transaction, so IndexedDB rolls back every write in it (16.4). Change
 * listeners run only after `tx.done` resolves.
 *
 * SSR-safe: nothing here touches IndexedDB at import time.
 */
import type { IDBPTransaction, IndexKey, IndexNames, StoreKey, StoreNames } from "idb";
import type { Result } from "@/core/backup";
import {
  MODEL_SCHEMAS,
  type ActivityLog,
  type BackupMeta,
  type BrowserRecord,
  type Chat,
  type CheckIn,
  type Memory,
  type Message,
  type Profile,
  type ProfileMeta,
  type Settings,
  type StoreName,
  type Summary,
} from "@/core/models";
import type { CompanionDB, CompanionDatabase, OpenResult } from "./db";

export type { Result };

export type RepoMode = "ready" | "read_only" | "unavailable";

/** Who started an operation; captured when the operation starts (20.7, 20.8, 20.29). */
export interface OperationContext {
  profileId: string;
  chatId?: string;
  epoch: number;
}

export type RepoError =
  | { kind: "validation"; model: StoreName; fields: string[] }
  | { kind: "write_failed"; message: string }
  | { kind: "read_only" }
  | { kind: "stale" };

export type RecordOf<S extends StoreName> = CompanionDB[S]["value"];
export type KeyOf<S extends StoreName> = StoreKey<CompanionDB, S>;
export type RepoKey = string | [string, string];

/** Posted after a transaction commits (20.4; BroadcastChannel wiring is added by the Tab_Coordinator). */
export interface ChangeEvent {
  stores: StoreName[];
  profileId: string;
  /** Keys written (put). */
  ids: RepoKey[];
  /** Keys deleted. */
  deleted: RepoKey[];
  /** True when the change was committed in another tab (never re-broadcast). */
  remote?: boolean;
}

export type ChangeListener = (event: ChangeEvent) => void;

/** Operations available inside `repo.tx`. Only await these (no unrelated awaits), or the transaction auto-commits. */
export interface TxApi {
  /** Validates, guards, checks references, then writes. Throws (aborting the tx) on failure. */
  put<S extends StoreName>(store: S, rec: RecordOf<S>): Promise<void>;
  /** Deletes by key. A profile-scoped record owned by another Profile aborts the tx. */
  delete<S extends StoreName>(store: S, key: KeyOf<S>): Promise<void>;
  get<S extends StoreName>(store: S, key: KeyOf<S>): Promise<RecordOf<S> | undefined>;
  getAll<S extends StoreName>(store: S, query?: KeyOf<S> | IDBKeyRange): Promise<RecordOf<S>[]>;
  getAllByIndex<S extends StoreName, I extends IndexNames<CompanionDB, S>>(
    store: S,
    index: I,
    query?: IndexKey<CompanionDB, S, I> | IDBKeyRange,
  ): Promise<RecordOf<S>[]>;
}

/** Inside `clearStores`: records may belong to any Profile (validation and references still apply). */
export type RestoreTxApi = TxApi;

export interface MessagesQuery {
  /** Return at most this many messages (the most recent ones). */
  limit?: number;
  /** Only messages with `createdAt` strictly earlier than this timestamp. */
  before?: string;
}

export interface Repo {
  readonly mode: RepoMode;
  put<S extends StoreName>(op: OperationContext, store: S, rec: RecordOf<S>): Promise<Result<void, RepoError>>;
  tx<T>(op: OperationContext, stores: StoreName[], fn: (t: TxApi) => Promise<T>): Promise<Result<T, RepoError>>;
  /** Deletes one record by key (owner-checked like `put`). */
  delete<S extends StoreName>(op: OperationContext, store: S, key: KeyOf<S>): Promise<Result<void, RepoError>>;
  /**
   * Restore path (18.x, 20.29): clears `stores` and optionally refills them in
   * the same transaction. Ownership checks are skipped so records of every
   * Profile can be written; zod validation and referential checks still apply.
   * Any failure rolls back both the clear and the refill.
   */
  clearStores(
    op: OperationContext,
    stores: StoreName[],
    refill?: (t: RestoreTxApi) => Promise<void>,
  ): Promise<Result<void, RepoError>>;
  onChange(listener: ChangeListener): () => void;
  /**
   * Delivers a ChangeEvent committed in another tab to this tab's listeners
   * (20.4, 20.5). The event is marked `remote` so it is not broadcast again.
   */
  notifyExternalChange(event: ChangeEvent): void;

  /** Profiles, most recently used first. */
  getProfiles(): Promise<Profile[]>;
  getProfile(id: string): Promise<Profile | undefined>;
  getSettings(profileId: string): Promise<Settings | undefined>;
  /** Chats of a Profile, most recently updated first. */
  listChats(profileId: string): Promise<Chat[]>;
  getChat(id: string): Promise<Chat | undefined>;
  /** Messages of a Chat, oldest first (the newest `limit` if given). */
  messagesByChat(chatId: string, query?: MessagesQuery): Promise<Message[]>;
  memoriesByProfile(profileId: string): Promise<Memory[]>;
  /** Activity logs of a Profile, oldest first. */
  activityByProfile(profileId: string): Promise<ActivityLog[]>;
  getSummary(profileId: string): Promise<Summary | undefined>;
  getProfileMeta(profileId: string): Promise<ProfileMeta | undefined>;
  getCheckIn(profileId: string, date: string): Promise<CheckIn | undefined>;
  getBrowserRecord(): Promise<BrowserRecord | undefined>;
  /** Backup metadata, newest first. */
  listBackupMeta(): Promise<BackupMeta[]>;

  close(): void;
}

export interface RepositoryOptions {
  /**
   * Evaluated inside the transaction before every write. Must be synchronous
   * (an unrelated await would auto-commit the transaction). Returning `true`
   * aborts with `{ kind: "stale" }`, e.g. when the epoch or Active_Profile
   * changed since the operation started (20.7, 20.29).
   */
  isStale?: (op: OperationContext) => boolean;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

type RwTx = IDBPTransaction<CompanionDB, StoreNames<CompanionDB>[], "readwrite">;

/** Stores whose records are not owned by a single Profile (20.8 exemption). */
const UNSCOPED: ReadonlySet<StoreName> = new Set<StoreName>(["browser", "backupMeta"]);

/** Stores each store's referential checks read; added to the tx scope automatically. */
const DEPENDENCIES: Readonly<Record<StoreName, readonly StoreName[]>> = {
  profiles: [],
  settings: ["profiles"],
  chats: ["profiles"],
  messages: ["profiles", "chats"],
  memories: ["profiles", "chats", "messages"],
  activityLogs: ["profiles"],
  summaries: ["profiles"],
  backupMeta: [],
  checkIns: ["profiles"],
  profileMeta: ["profiles"],
  browser: [],
};

/** Upper bound for string index components; model timestamps/ids are well below it. */
const MAX_STRING = "\uffff";

class RepoAbort extends Error {
  constructor(readonly error: RepoError) {
    super(error.kind);
    this.name = "RepoAbort";
  }
}

/** Logs a rejected write naming only the model, fields, and issue codes, never values (19.11, 7.8). */
function logValidation(model: StoreName, fields: string[], codes: string[] = []) {
  console.warn(`[repo] rejected ${model} record; failing fields: ${fields.join(", ")}`, codes.length ? { codes } : "");
}

function validationAbort(model: StoreName, fields: string[], codes?: string[]): RepoAbort {
  const unique = [...new Set(fields)];
  logValidation(model, unique, codes);
  return new RepoAbort({ kind: "validation", model, fields: unique });
}

/** The profileId that owns `rec` in `store`, or undefined for unscoped stores. */
function ownerOf(store: StoreName, rec: unknown): unknown {
  if (UNSCOPED.has(store)) return undefined;
  const r = rec as Record<string, unknown>;
  return store === "profiles" ? r.id : r.profileId;
}

async function referenceFailures(t: RwTx, store: StoreName, rec: unknown): Promise<string[]> {
  if (store === "profiles" || UNSCOPED.has(store)) return [];
  const r = rec as { profileId: string };
  const failures: string[] = [];
  if (!(await t.objectStore("profiles").get(r.profileId))) failures.push("profileId");

  if (store === "messages") {
    const m = rec as Message;
    const chat = await t.objectStore("chats").get(m.chatId);
    if (!chat || chat.profileId !== m.profileId) failures.push("chatId");
  } else if (store === "memories") {
    const mem = rec as Memory;
    const chats = t.objectStore("chats");
    for (const id of mem.sourceChatIds) {
      const c = await chats.get(id);
      if (!c || c.profileId !== mem.profileId) {
        failures.push("sourceChatIds");
        break;
      }
    }
    const messages = t.objectStore("messages");
    for (const id of mem.sourceMessageIds) {
      const m = await messages.get(id);
      if (!m || m.profileId !== mem.profileId) {
        failures.push("sourceMessageIds");
        break;
      }
    }
  }
  return failures;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error || err instanceof DOMException) return err.name ? `${err.name}: ${err.message}` : err.message;
  return "Unknown error";
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createRepository(open: OpenResult, options: RepositoryOptions = {}): Repo {
  const db: CompanionDatabase | null = open.mode === "ready" ? open.db : null;
  const mode: RepoMode = open.mode;
  const listeners = new Set<ChangeListener>();

  const emit = (event: ChangeEvent) => {
    for (const l of [...listeners]) {
      try {
        l(event);
      } catch (err) {
        console.error("[repo] change listener failed", err);
      }
    }
  };

  interface RunOptions {
    /** Skip the 20.8 ownership check (restore only). */
    crossProfile?: boolean;
    /** Stores cleared at the start of the transaction (restore only). */
    clear?: StoreName[];
  }

  function tx<T>(
    op: OperationContext,
    stores: StoreName[],
    fn: (t: TxApi) => Promise<T>,
  ): Promise<Result<T, RepoError>> {
    return run(op, stores, fn, {});
  }

  async function run<T>(
    op: OperationContext,
    stores: StoreName[],
    fn: (t: TxApi) => Promise<T>,
    runOptions: RunOptions,
  ): Promise<Result<T, RepoError>> {
    if (!db) return { ok: false, error: { kind: "read_only" } };
    const checkOwner = !runOptions.crossProfile;

    const scope = new Set<StoreName>(stores);
    for (const s of stores) for (const d of DEPENDENCIES[s]) scope.add(d);

    let t: RwTx;
    try {
      t = db.transaction([...scope], "readwrite");
    } catch (err) {
      return { ok: false, error: { kind: "write_failed", message: errorMessage(err) } };
    }
    // Abort is reported below; don't leak an unhandled rejection from `done`.
    t.done.catch(() => undefined);

    const written = new Set<StoreName>();
    const ids: RepoKey[] = [];
    const deleted: RepoKey[] = [];

    const guardStale = () => {
      if (options.isStale?.(op)) throw new RepoAbort({ kind: "stale" });
    };

    const api: TxApi = {
      async put(store, rec) {
        guardStale();
        const parsed = MODEL_SCHEMAS[store].safeParse(rec);
        if (!parsed.success) {
          const issues = parsed.error.issues;
          throw validationAbort(
            store,
            issues.map((i) => (i.path.length ? i.path.map(String).join(".") : "(record)")),
            issues.map((i) => i.code),
          );
        }
        const value = parsed.data as RecordOf<typeof store>;
        const owner = ownerOf(store, value);
        if (checkOwner && owner !== undefined && owner !== op.profileId) {
          throw validationAbort(store, [store === "profiles" ? "id" : "profileId"]);
        }
        const refs = await referenceFailures(t, store, value);
        if (refs.length) throw validationAbort(store, refs);
        // Generic store typing in idb is a union; the value was validated for `store`.
        const key = await (t.objectStore(store) as unknown as IDBPObjectStoreLike).put(value);
        written.add(store);
        ids.push(key as RepoKey);
      },
      async delete(store, key) {
        guardStale();
        const os = t.objectStore(store) as unknown as IDBPObjectStoreLike;
        if (checkOwner && !UNSCOPED.has(store)) {
          const existing = await os.get(key);
          if (existing !== undefined && ownerOf(store, existing) !== op.profileId) {
            throw validationAbort(store, [store === "profiles" ? "id" : "profileId"]);
          }
        }
        await os.delete(key);
        written.add(store);
        deleted.push(key as RepoKey);
      },
      async get(store, key) {
        return (await (t.objectStore(store) as unknown as IDBPObjectStoreLike).get(key)) as never;
      },
      async getAll(store, query) {
        return (await (t.objectStore(store) as unknown as IDBPObjectStoreLike).getAll(query)) as never;
      },
      async getAllByIndex(store, index, query) {
        const os = t.objectStore(store) as unknown as IDBPObjectStoreLike;
        return (await os.index(index as string).getAll(query)) as never;
      },
    };

    let value: T;
    try {
      guardStale();
      for (const s of runOptions.clear ?? []) {
        await (t.objectStore(s) as unknown as IDBPObjectStoreLike).clear();
        written.add(s);
      }
      value = await fn(api);
    } catch (err) {
      try {
        t.abort();
      } catch {
        // Already aborted or finished.
      }
      if (err instanceof RepoAbort) return { ok: false, error: err.error };
      return { ok: false, error: { kind: "write_failed", message: errorMessage(err) } };
    }

    try {
      await t.done;
    } catch (err) {
      return { ok: false, error: { kind: "write_failed", message: errorMessage(err ?? t.error) } };
    }

    if (written.size > 0) {
      emit({ stores: [...written], profileId: op.profileId, ids, deleted });
    }
    return { ok: true, value };
  }

  const readTx = <S extends StoreName>(store: S) => db!.transaction(store, "readonly").objectStore(store);

  const repo: Repo = {
    mode,
    tx,
    put: (op, store, rec) => tx(op, [store], (t) => t.put(store, rec)),
    delete: (op, store, key) => tx(op, [store], (t) => t.delete(store, key)),
    clearStores: (op, stores, refill) =>
      run(op, stores, (t) => (refill ? refill(t) : Promise.resolve()), { crossProfile: true, clear: stores }),
    onChange(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    notifyExternalChange(event) {
      if (!event || !Array.isArray(event.stores)) return;
      emit({
        stores: [...event.stores],
        profileId: event.profileId,
        ids: Array.isArray(event.ids) ? event.ids : [],
        deleted: Array.isArray(event.deleted) ? event.deleted : [],
        remote: true,
      });
    },

    async getProfiles() {
      if (!db) return [];
      return (await db.getAllFromIndex("profiles", "byLastUsed")).reverse();
    },
    async getProfile(id) {
      return db ? db.get("profiles", id) : undefined;
    },
    async getSettings(profileId) {
      return db ? db.get("settings", profileId) : undefined;
    },
    async listChats(profileId) {
      if (!db) return [];
      const range = IDBKeyRange.bound([profileId, ""], [profileId, MAX_STRING]);
      return (await db.getAllFromIndex("chats", "byProfileUpdated", range)).reverse();
    },
    async getChat(id) {
      return db ? db.get("chats", id) : undefined;
    },
    async messagesByChat(chatId, query = {}) {
      if (!db) return [];
      const { limit, before } = query;
      const range = IDBKeyRange.bound(
        [chatId, ""],
        [chatId, before ?? MAX_STRING],
        false,
        before !== undefined,
      );
      const index = readTx("messages").index("byChatCreated");
      if (limit === undefined) return index.getAll(range);
      if (limit <= 0) return [];
      const out: Message[] = [];
      for (let c = await index.openCursor(range, "prev"); c && out.length < limit; c = await c.continue()) {
        out.push(c.value);
      }
      return out.reverse();
    },
    async memoriesByProfile(profileId) {
      return db ? db.getAllFromIndex("memories", "byProfile", profileId) : [];
    },
    async activityByProfile(profileId) {
      if (!db) return [];
      const range = IDBKeyRange.bound([profileId, ""], [profileId, MAX_STRING]);
      return db.getAllFromIndex("activityLogs", "byProfileStarted", range);
    },
    async getSummary(profileId) {
      return db ? db.get("summaries", profileId) : undefined;
    },
    async getProfileMeta(profileId) {
      return db ? db.get("profileMeta", profileId) : undefined;
    },
    async getCheckIn(profileId, date) {
      return db ? db.get("checkIns", [profileId, date]) : undefined;
    },
    async getBrowserRecord() {
      return db ? db.get("browser", "singleton") : undefined;
    },
    async listBackupMeta() {
      if (!db) return [];
      return (await db.getAllFromIndex("backupMeta", "byCreated")).reverse();
    },

    close() {
      db?.close();
    },
  };
  return repo;
}

/** Minimal untyped view of an idb object store, used where the store name is generic. */
interface IDBPObjectStoreLike {
  put(value: unknown): Promise<IDBValidKey>;
  get(key: unknown): Promise<unknown>;
  getAll(query?: unknown): Promise<unknown[]>;
  delete(key: unknown): Promise<void>;
  clear(): Promise<void>;
  index(name: string): { getAll(query?: unknown): Promise<unknown[]> };
}

// ---------------------------------------------------------------------------
// Shared instance (React and services use the same Repo)
// ---------------------------------------------------------------------------

let instance: Repo | null = null;
let opening: Promise<Repo> | null = null;
const instanceListeners = new Set<() => void>();

/** The shared Repo once `initRepo` has resolved; `null` before that and during SSR. */
export function getRepo(): Repo | null {
  return instance;
}

/** Notifies when the shared instance is set or replaced. Returns an unsubscribe. */
export function subscribeRepo(listener: () => void): () => void {
  instanceListeners.add(listener);
  return () => void instanceListeners.delete(listener);
}

function setInstance(repo: Repo | null) {
  instance = repo;
  for (const l of [...instanceListeners]) l();
}

/**
 * Opens the Local_Store once and shares the Repo. Idempotent: later calls get
 * the same promise. On the server it resolves to an `unavailable` repo without
 * touching IndexedDB and does not cache it.
 */
export function initRepo(options: RepositoryOptions = {}): Promise<Repo> {
  if (typeof window === "undefined") {
    return Promise.resolve(createRepository({ mode: "unavailable", reason: "not_supported" }, options));
  }
  if (instance) return Promise.resolve(instance);
  if (!opening) {
    opening = import("./db")
      .then(({ openDatabase }) => openDatabase())
      .then((open) => {
        const repo = createRepository(open, options);
        setInstance(repo);
        return repo;
      })
      .finally(() => {
        opening = null;
      });
  }
  return opening;
}

/** Closes and forgets the shared instance (e.g. before a full reload after restore). */
export function resetRepo(): void {
  instance?.close();
  opening = null;
  setInstance(null);
}

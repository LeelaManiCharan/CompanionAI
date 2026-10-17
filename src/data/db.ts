/**
 * IndexedDB schema, open, and migrations (Req 16.3, 16.6–16.8, 19.15).
 *
 * SSR-safe: nothing here touches `indexedDB` at import time. The global is read
 * only when `openDatabase()` is called.
 */
import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreNames } from "idb";
import {
  SCHEMA_VERSION,
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

export const DB_NAME = "companion";

/** Maximum time before an open that has not settled is reported as unavailable (16.8). */
export const OPEN_TIMEOUT_MS = 3_000;

/** Typed idb schema. Store names match `MODEL_SCHEMAS` keys. */
export interface CompanionDB extends DBSchema {
  profiles: { key: string; value: Profile; indexes: { byLastUsed: string } };
  settings: { key: string; value: Settings };
  chats: {
    key: string;
    value: Chat;
    indexes: { byProfile: string; byProfileUpdated: [string, string] };
  };
  messages: {
    key: string;
    value: Message;
    indexes: { byChat: string; byChatCreated: [string, string]; byProfile: string };
  };
  memories: {
    key: string;
    value: Memory;
    // `bySourceChat` is multiEntry over `sourceChatIds`.
    indexes: { byProfile: string; bySourceChat: string };
  };
  activityLogs: {
    key: string;
    value: ActivityLog;
    indexes: { byProfile: string; byProfileStarted: [string, string] };
  };
  summaries: { key: string; value: Summary };
  backupMeta: { key: string; value: BackupMeta; indexes: { byCreated: string } };
  checkIns: { key: [string, string]; value: CheckIn };
  profileMeta: { key: string; value: ProfileMeta };
  browser: { key: "singleton"; value: BrowserRecord };
}

// Compile-time check that the DB stores and the model stores are the same set.
type _SameStores = [StoreNames<CompanionDB>] extends [StoreName]
  ? [StoreName] extends [StoreNames<CompanionDB>]
    ? true
    : never
  : never;
const _sameStores: _SameStores = true;
void _sameStores;

export type CompanionDatabase = IDBPDatabase<CompanionDB>;
export type UpgradeTransaction = IDBPTransaction<CompanionDB, StoreNames<CompanionDB>[], "versionchange">;

/**
 * Migration step that brings the database from `v - 1` to `v`. Runs inside the
 * version-change transaction. A thrown error or rejected promise aborts the
 * transaction, so the old data and version survive (16.6, 16.7). Async steps
 * must only await requests on `tx` (no unrelated awaits), or the transaction
 * auto-commits.
 */
export type Migration = (db: CompanionDatabase, tx: UpgradeTransaction) => void | Promise<void>;

/** Ordered migrations keyed by target version. Must cover 1..SCHEMA_VERSION. */
export const migrations: Readonly<Record<number, Migration>> = {
  1: (db) => {
    const profiles = db.createObjectStore("profiles", { keyPath: "id" });
    profiles.createIndex("byLastUsed", "lastUsedAt");

    db.createObjectStore("settings", { keyPath: "profileId" });

    const chats = db.createObjectStore("chats", { keyPath: "id" });
    chats.createIndex("byProfile", "profileId");
    chats.createIndex("byProfileUpdated", ["profileId", "updatedAt"]);

    const messages = db.createObjectStore("messages", { keyPath: "id" });
    messages.createIndex("byChat", "chatId");
    messages.createIndex("byChatCreated", ["chatId", "createdAt"]);
    messages.createIndex("byProfile", "profileId");

    const memories = db.createObjectStore("memories", { keyPath: "id" });
    memories.createIndex("byProfile", "profileId");
    memories.createIndex("bySourceChat", "sourceChatIds", { multiEntry: true });

    const activityLogs = db.createObjectStore("activityLogs", { keyPath: "id" });
    activityLogs.createIndex("byProfile", "profileId");
    activityLogs.createIndex("byProfileStarted", ["profileId", "startedAt"]);

    db.createObjectStore("summaries", { keyPath: "profileId" });

    const backupMeta = db.createObjectStore("backupMeta", { keyPath: "id" });
    backupMeta.createIndex("byCreated", "createdAt");

    db.createObjectStore("checkIns", { keyPath: ["profileId", "date"] });
    db.createObjectStore("profileMeta", { keyPath: "profileId" });
    // Browser-level record (19.15); its only key is "singleton".
    db.createObjectStore("browser", { keyPath: "id" });
  },
};

export type ReadOnlyReason = "newer_version" | "migration_failed";
export type UnavailableReason = "not_supported" | "blocked" | "timeout" | "open_failed";

export type OpenResult =
  | { mode: "ready"; db: CompanionDatabase }
  | { mode: "read_only"; reason: ReadOnlyReason }
  | { mode: "unavailable"; reason: UnavailableReason };

export interface OpenOptions {
  /** Defaults to `OPEN_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Test seam; defaults to `SCHEMA_VERSION`. */
  version?: number;
  /** Test seam; defaults to `migrations`. */
  migrations?: Readonly<Record<number, Migration>>;
}

class MigrationError extends Error {
  constructor(
    readonly version: number,
    cause: unknown,
  ) {
    super(`Migration to version ${version} failed`, { cause });
    this.name = "MigrationError";
  }
}

/**
 * Opens (and if needed migrates) the Local_Store. Never rejects.
 *
 * - `ready`: opened at `SCHEMA_VERSION`, migrations (if any) committed.
 * - `read_only`: stored version is newer (`VersionError`) or a migration failed.
 *   Nothing was written; the caller must not write this session (16.7).
 * - `unavailable`: IndexedDB missing, threw, or the open did not settle
 *   within the timeout, e.g. blocked by another tab (16.8).
 */
export function openDatabase(name: string = DB_NAME, options: OpenOptions = {}): Promise<OpenResult> {
  const timeoutMs = options.timeoutMs ?? OPEN_TIMEOUT_MS;
  const version = options.version ?? SCHEMA_VERSION;
  const steps = options.migrations ?? migrations;

  if (typeof indexedDB === "undefined" || indexedDB === null) {
    return Promise.resolve({ mode: "unavailable", reason: "not_supported" });
  }

  return new Promise<OpenResult>((resolve) => {
    let settled = false;
    let blocked = false;
    let migrationFailed = false;

    const finish = (result: OpenResult) => {
      if (settled) {
        // A late success after we already reported: release the connection.
        if (result.mode === "ready") result.db.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(
      () => finish({ mode: "unavailable", reason: blocked ? "blocked" : "timeout" }),
      timeoutMs,
    );

    let opening: Promise<CompanionDatabase>;
    try {
      opening = openDB<CompanionDB>(name, version, {
        upgrade(db, oldVersion, newVersion, tx) {
          // An abort is reported through the open request; don't leak an
          // unhandled rejection from idb's `tx.done`.
          tx.done.catch(() => undefined);
          const fail = (err: unknown) => {
            migrationFailed = true;
            console.error(err);
            try {
              tx.abort();
            } catch {
              // Already aborted/finished.
            }
          };
          // Steps run synchronously until one returns a promise; the rest are
          // then chained after it, all inside the same transaction.
          const runFrom = (from: number): void | Promise<void> => {
            for (let v = from; v <= (newVersion ?? version); v++) {
              const step = steps[v];
              if (!step) throw new MigrationError(v, new Error("No migration registered"));
              let out: void | Promise<void>;
              try {
                out = step(db, tx);
              } catch (err) {
                throw new MigrationError(v, err);
              }
              if (out instanceof Promise) {
                const next = v + 1;
                return out.then(
                  () => runFrom(next),
                  (err: unknown) => {
                    throw new MigrationError(v, err);
                  },
                );
              }
            }
          };
          try {
            const pending = runFrom(oldVersion + 1);
            if (pending) pending.catch(fail);
          } catch (err) {
            fail(err);
          }
        },
        blocked() {
          blocked = true;
        },
        blocking() {
          // Another tab needs a newer version; let it proceed.
          void opening.then((db) => db.close()).catch(() => undefined);
        },
      });
    } catch {
      finish({ mode: "unavailable", reason: "open_failed" });
      return;
    }

    opening.then(
      (db) => finish({ mode: "ready", db }),
      (err: unknown) => {
        const errName = err instanceof Error || err instanceof DOMException ? err.name : "";
        if (errName === "VersionError") finish({ mode: "read_only", reason: "newer_version" });
        else if (migrationFailed) finish({ mode: "read_only", reason: "migration_failed" });
        else finish({ mode: "unavailable", reason: "open_failed" });
      },
    );
  });
}

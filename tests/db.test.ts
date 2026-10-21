import { afterEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { MODEL_SCHEMAS, SCHEMA_VERSION } from "@/core/models";
import { migrations, openDatabase, type Migration } from "@/data/db";

let n = 0;
const freshName = () => `test-db-${Date.now()}-${n++}`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("openDatabase", () => {
  it("creates every model store with its indexes at SCHEMA_VERSION", async () => {
    const res = await openDatabase(freshName());
    expect(res.mode).toBe("ready");
    if (res.mode !== "ready") return;
    const { db } = res;
    expect(db.version).toBe(SCHEMA_VERSION);
    expect([...db.objectStoreNames].sort()).toEqual(Object.keys(MODEL_SCHEMAS).sort());

    const tx = db.transaction(["messages", "memories", "checkIns", "settings"]);
    const messages = tx.objectStore("messages");
    expect([...messages.indexNames].sort()).toEqual(["byChat", "byChatCreated", "byProfile"]);
    expect(messages.index("byChatCreated").keyPath).toEqual(["chatId", "createdAt"]);
    expect(tx.objectStore("memories").index("bySourceChat").multiEntry).toBe(true);
    expect(tx.objectStore("checkIns").keyPath).toEqual(["profileId", "date"]);
    expect(tx.objectStore("settings").keyPath).toBe("profileId");
    await tx.done;
    db.close();
  });

  it("returns read_only for a stored version newer than SCHEMA_VERSION and leaves it intact", async () => {
    const name = freshName();
    const newer = await openDB(name, SCHEMA_VERSION + 1, {
      upgrade(db) {
        db.createObjectStore("future", { keyPath: "id" }).put({ id: "x" });
      },
    });
    newer.close();

    const res = await openDatabase(name);
    expect(res).toEqual({ mode: "read_only", reason: "newer_version" });

    const check = await openDB(name);
    expect(check.version).toBe(SCHEMA_VERSION + 1);
    expect(await check.get("future", "x")).toEqual({ id: "x" });
    check.close();
  });

  it("returns read_only when a migration throws and keeps the old version and data", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const name = freshName();
    const v1 = await openDatabase(name, { version: 1 });
    if (v1.mode !== "ready") throw new Error("setup failed");
    await v1.db.put("browser", {
      id: "singleton",
      backupNamespaceId: "A".repeat(22),
      createdAt: "2024-01-01T00:00:00.000Z",
      epoch: 0,
      cloudStoreConfig: null,
    });
    v1.db.close();

    const failing: Migration = () => {
      throw new Error("boom");
    };
    const res = await openDatabase(name, { version: 2, migrations: { ...migrations, 2: failing } });
    expect(res).toEqual({ mode: "read_only", reason: "migration_failed" });

    const after = await openDatabase(name, { version: 1 });
    expect(after.mode).toBe("ready");
    if (after.mode !== "ready") return;
    expect(after.db.version).toBe(1);
    expect((await after.db.get("browser", "singleton"))?.epoch).toBe(0);
    after.db.close();
  });

  it("returns unavailable when IndexedDB is missing", async () => {
    vi.stubGlobal("indexedDB", undefined);
    await expect(openDatabase(freshName())).resolves.toEqual({ mode: "unavailable", reason: "not_supported" });
  });

  it("returns unavailable within the timeout when the open is blocked", async () => {
    const name = freshName();
    // Old connection that ignores versionchange, so an upgrade is blocked.
    const old = await openDB(name, 1, { upgrade: (db) => void db.createObjectStore("x") });
    const res = await openDatabase(name, {
      timeoutMs: 100,
      version: 2,
      migrations: { ...migrations, 2: () => undefined },
    });
    expect(res).toEqual({ mode: "unavailable", reason: "blocked" });
    old.close();
  });
});

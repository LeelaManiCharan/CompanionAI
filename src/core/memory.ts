/**
 * Memory_Extractor / Memory_Store pure logic (Req 8, 10.3, 10.4, 20.26).
 *
 * - `parseExtraction` turns raw model output into validated memory items.
 * - `mergeMemories` de-duplicates new items against existing memories.
 * - `appendCapped` maintains the FIFO-capped source reference lists.
 * - `forgetChat` computes the memory changes caused by deleting a chat.
 *
 * This module is pure: no DOM, no IndexedDB, no network.
 */
import { MemoryCategorySchema, type Memory, type MemoryCategory } from "@/core/models";

/** At most 5 memories are kept from one extraction (8.1). */
export const MAX_EXTRACTED_MEMORIES = 5;
/** Memory content length bounds after trimming (8.2, 19.5). */
export const MEMORY_CONTENT_MIN = 1;
export const MEMORY_CONTENT_MAX = 500;
/** Max entries in `sourceChatIds` / `sourceMessageIds` (8.10, 8.11). */
export const SOURCE_CAP = 100;

export interface ExtractedItem {
  category: MemoryCategory;
  /** Trimmed, 1–500 characters. */
  content: string;
}

export type ParseExtractionResult = { ok: true; items: ExtractedItem[] } | { ok: false };

/** Removes a surrounding Markdown code fence (``` or ```json) if present. */
function stripCodeFence(text: string): string {
  const fenced = /^```[^\n]*\n([\s\S]*?)\n?```$/.exec(text);
  return fenced ? (fenced[1] ?? "").trim() : text;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Parses extraction output of the form `{"memories":[{category, content}]}`.
 * Non-JSON or wrong top-level shape → `{ ok: false }`, which callers treat as a
 * Model_Router error (20.26). Individually invalid items are dropped (8.9) and
 * at most 5 valid items are kept, in output order (8.1).
 */
export function parseExtraction(raw: string): ParseExtractionResult {
  let data: unknown;
  try {
    data = JSON.parse(stripCodeFence(raw.trim()));
  } catch {
    return { ok: false };
  }
  if (!isRecord(data) || !Array.isArray(data.memories)) return { ok: false };

  const items: ExtractedItem[] = [];
  for (const entry of data.memories as unknown[]) {
    if (items.length >= MAX_EXTRACTED_MEMORIES) break;
    if (!isRecord(entry)) continue;
    const category = MemoryCategorySchema.safeParse(entry.category);
    if (!category.success || typeof entry.content !== "string") continue;
    const content = entry.content.trim();
    if (content.length < MEMORY_CONTENT_MIN || content.length > MEMORY_CONTENT_MAX) continue;
    items.push({ category: category.data, content });
  }
  return { ok: true, items };
}

/**
 * Appends `add` to `list` with de-duplication and FIFO capping (8.10).
 * An id already in `list` that is re-added moves to the end (it is the newest
 * reference). The newest `cap` entries are kept.
 */
export function appendCapped(list: readonly string[], add: readonly string[], cap = SOURCE_CAP): string[] {
  const addUnique = [...new Set(add)];
  const addSet = new Set(addUnique);
  const kept = [...new Set(list)].filter((id) => !addSet.has(id));
  const combined = [...kept, ...addUnique];
  return combined.length > cap ? combined.slice(combined.length - cap) : combined;
}

/** De-duplication key: category + trimmed, lower-cased content (8.4). */
export const memoryKey = (category: MemoryCategory, content: string): string =>
  `${category}\u0000${content.trim().toLowerCase()}`;

export interface MemorySource {
  profileId: string;
  chatId: string;
  /** The user message id and, if present, the preceding companion message id. */
  messageIds: readonly string[];
}

export interface MergeResult {
  /** New or changed memories to write (each id appears once). */
  upserts: Memory[];
  /** Number of brand-new memories among `upserts`. */
  createdCount: number;
}

const laterOf = (a: string, b: string) => (Date.parse(a) >= Date.parse(b) ? a : b);

/**
 * Merges extracted items into the profile's existing memories (8.3, 8.4).
 * A duplicate (same category and trimmed, case-insensitive content) updates the
 * existing memory's `updatedAt` and appends the source ids with the 100-entry
 * cap; otherwise a new memory linked to the source chat and messages is created.
 * Duplicates within `items` also collapse into one memory.
 */
export function mergeMemories(
  existing: readonly Memory[],
  items: readonly ExtractedItem[],
  src: MemorySource,
  now: string,
  newId: () => string,
): MergeResult {
  const byKey = new Map<string, Memory>();
  for (const m of existing) {
    const key = memoryKey(m.category, m.content);
    if (!byKey.has(key)) byKey.set(key, m);
  }

  const changed = new Map<string, Memory>();
  let createdCount = 0;

  for (const item of items) {
    const key = memoryKey(item.category, item.content);
    const current = byKey.get(key);
    let next: Memory;
    if (current) {
      next = {
        ...current,
        sourceChatIds: appendCapped(current.sourceChatIds, [src.chatId]),
        sourceMessageIds: appendCapped(current.sourceMessageIds, src.messageIds),
        updatedAt: laterOf(now, current.createdAt),
      };
    } else {
      next = {
        id: newId(),
        profileId: src.profileId,
        category: item.category,
        content: item.content.trim(),
        sourceChatIds: appendCapped([], [src.chatId]),
        sourceMessageIds: appendCapped([], src.messageIds),
        createdAt: now,
        updatedAt: now,
      };
      createdCount++;
    }
    byKey.set(key, next);
    changed.set(next.id, next);
  }

  return { upserts: [...changed.values()], createdCount };
}

export interface ForgetResult {
  /** Memories to delete (their only source chat, or all source messages, were removed). */
  deleteIds: string[];
  /** Memories that keep other sources, with the deleted chat's references removed. */
  updates: Memory[];
}

/**
 * Computes memory changes when a chat is deleted (10.3, 10.4). The chat id and
 * that chat's message ids are removed from every memory; a memory left with no
 * source chats or no source messages is deleted. Unaffected memories are not
 * returned.
 */
export function forgetChat(
  memories: readonly Memory[],
  chatId: string,
  chatMessageIds: ReadonlySet<string>,
): ForgetResult {
  const deleteIds: string[] = [];
  const updates: Memory[] = [];
  for (const m of memories) {
    const sourceChatIds = m.sourceChatIds.filter((id) => id !== chatId);
    const sourceMessageIds = m.sourceMessageIds.filter((id) => !chatMessageIds.has(id));
    if (sourceChatIds.length === m.sourceChatIds.length && sourceMessageIds.length === m.sourceMessageIds.length) {
      continue;
    }
    if (sourceChatIds.length === 0 || sourceMessageIds.length === 0) {
      deleteIds.push(m.id);
    } else {
      updates.push({ ...m, sourceChatIds, sourceMessageIds });
    }
  }
  return { deleteIds, updates };
}

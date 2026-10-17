"use client";

/**
 * Wires the Repository to the Tab_Coordinator (Req 20.4, 20.5, 20.29).
 *
 * - Local commits (repo.onChange, not marked `remote`) are broadcast to other tabs.
 * - Remote commits are re-emitted into this tab's repository listeners via
 *   `notifyExternalChange` (marked `remote`, so they are never re-broadcast), which
 *   makes useLiveQuery, the scheduler and the activity tracker refresh.
 * - A "reload-all" notice (after a restore in another tab) reloads the page.
 * - A Profile or open Chat deleted elsewhere raises a short toast; the views
 *   themselves already render their "no longer here" states.
 */
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import type { ChangeEvent, Repo } from "@/data/repository";
import { getActiveProfileId } from "@/services/session";
import { broadcastChange, onReloadAll, onRemoteChange } from "@/services/tabCoordinator";
import { useToast } from "@/components/ui/Toast";

const keyMatches = (keys: ChangeEvent["deleted"], id: string): boolean =>
  keys.some((k) => (Array.isArray(k) ? k.includes(id) : k === id));

export function TabSync({ repo }: { repo: Repo | null }) {
  const { toast } = useToast();
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  useEffect(() => {
    pathRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    if (!repo) return;
    const offLocal = repo.onChange((event) => {
      if (!event.remote) broadcastChange(event);
    });
    const offRemote = onRemoteChange((event) => {
      if (!event || !Array.isArray(event.stores)) return;
      repo.notifyExternalChange(event);

      const deleted = Array.isArray(event.deleted) ? event.deleted : [];
      if (deleted.length === 0) return;
      const activeId = getActiveProfileId();
      const chatMatch = /^\/chat\/([^/?#]+)/.exec(pathRef.current ?? "");
      const openChatId = chatMatch ? decodeURIComponent(chatMatch[1]) : null;
      if (event.stores.includes("profiles") && activeId && keyMatches(deleted, activeId)) {
        toast({ title: "This profile was deleted in another tab" });
      } else if (event.stores.includes("chats") && openChatId && keyMatches(deleted, openChatId)) {
        toast({ title: "This chat was deleted in another tab" });
      }
    });
    return () => {
      offLocal();
      offRemote();
    };
  }, [repo, toast]);

  useEffect(() => onReloadAll(() => window.location.reload()), []);

  return null;
}

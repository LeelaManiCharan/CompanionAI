"use client";

/**
 * AppRoot (design "Rendering and hydration strategy"; Req 1.5, 1.6, 16.2,
 * 16.7, 16.8, 20.19, 20.20).
 *
 * Inside `useEffect` it opens the Local_Store (running migrations), loads the
 * browser record and the Active_Profile, then starts the Tab_Coordinator,
 * Activity_Tracker, Check_In_Scheduler, and service worker. Until that is done
 * it renders a static skeleton that is identical on server and client.
 */
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { StoreName } from "@/core/models";
import { initRepo, type Repo, type RepoMode } from "@/data/repository";
import { useLiveQuery } from "@/data/useLiveQuery";
import { startActivityTracker } from "@/services/activityTracker";
import { regenerateIfStale } from "@/services/memoryService";
import { modelRouter } from "@/services/modelRouter";
import { CALL_URL, onOpenCall, registerServiceWorker, serviceWorkerSupported } from "@/services/notifications";
import { loadActiveProfile } from "@/services/profileService";
import { startScheduler } from "@/services/scheduler";
import { getServerSession, getSession, subscribeSession } from "@/services/session";
import { acknowledgeGeminiNotice, ensureBrowserRecord } from "@/services/settingsService";
import { startTabCoordinator } from "@/services/tabCoordinator";
import { ActivityDisclosureDialog } from "./ActivityDisclosureDialog";
import { AppContext, type AppState } from "./appContext";
import { AppSkeleton } from "./AppSkeleton";
import { BreakSuggestionToast } from "./BreakSuggestionToast";
import { ProfileOnboarding } from "./ProfileOnboarding";
import { TabSync } from "./TabSync";
import { InlineAlert } from "@/components/ui";

/** Usage at or above this share of quota raises the storage warning (20.20). */
const USAGE_WARN_RATIO = 0.8;

type Scoped<T> = { id: string; value: T | undefined } | null;

/**
 * Live record keyed by the active Profile id. The result carries the id it was
 * read for, so a stale value from the previous Profile is never exposed.
 */
function useProfileRecord<T>(
  id: string | null,
  stores: readonly StoreName[],
  read: (repo: Repo, id: string) => Promise<T | undefined>,
  repo: Repo | null,
) {
  const q = useLiveQuery<Scoped<T>>(
    async () => (id && repo ? { id, value: await read(repo, id) } : null),
    stores,
    [id, repo],
  );
  const settled = id === null || q.data?.id === id;
  return { settled, value: id !== null && q.data?.id === id ? (q.data.value ?? null) : null };
}

export function AppRoot({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [repo, setRepo] = useState<Repo | null>(null);
  const [booted, setBooted] = useState(false);
  const [persistDenied, setPersistDenied] = useState(false);
  const [usagePercent, setUsagePercent] = useState<number | null>(null);

  const { activeProfileId } = useSyncExternalStore(subscribeSession, getSession, getServerSession);
  const repoMode: RepoMode = repo?.mode ?? "unavailable";

  const profile = useProfileRecord(activeProfileId, ["profiles"], (r, id) => r.getProfile(id), repo);
  const settings = useProfileRecord(activeProfileId, ["settings"], (r, id) => r.getSettings(id), repo);
  const profileMeta = useProfileRecord(activeProfileId, ["profileMeta"], (r, id) => r.getProfileMeta(id), repo);

  // -------------------------------------------------------------------------
  // Storage persistence and quota (20.19, 20.20)
  // -------------------------------------------------------------------------

  const checkStorage = useCallback(async () => {
    try {
      const est = await navigator.storage?.estimate?.();
      if (!est || !est.quota) return;
      const ratio = (est.usage ?? 0) / est.quota;
      setUsagePercent(ratio >= USAGE_WARN_RATIO ? Math.min(100, Math.floor(ratio * 100)) : null);
    } catch {
      /* estimate is best-effort */
    }
  }, []);

  const requestPersistence = useCallback(async () => {
    const storage = navigator.storage;
    if (!storage?.persist) return;
    try {
      if (storage.persisted && (await storage.persisted())) return;
      const granted = await storage.persist();
      setPersistDenied(!granted);
    } catch {
      /* not supported in this context */
    }
  }, []);

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let opened: Repo | null = null;
      try {
        opened = await initRepo();
      } catch {
        opened = null;
      }
      if (cancelled) return;
      setRepo(opened);

      if (opened && opened.mode !== "unavailable") {
        await ensureBrowserRecord();
        await loadActiveProfile();
      }
      if (cancelled) return;

      // All of these are idempotent and SSR-safe.
      startTabCoordinator();
      startActivityTracker();
      startScheduler();
      if (serviceWorkerSupported()) void registerServiceWorker();
      void requestPersistence();
      void checkStorage();

      setBooted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [checkStorage, requestPersistence]);

  // Gemini_Privacy_Notice acceptance is stored per Profile (6.21).
  useEffect(() => {
    modelRouter.setAcknowledgeHandler(async (profileId) => {
      await acknowledgeGeminiNotice(profileId);
    });
    return () => modelRouter.setAcknowledgeHandler(null);
  }, []);

  // Notification click → open the call screen (13.4).
  useEffect(() => onOpenCall(() => router.push(CALL_URL)), [router]);

  // The active Profile record vanished (e.g. deleted in another tab): re-pick.
  useEffect(() => {
    if (booted && activeProfileId && profile.settled && profile.value === null && repoMode === "ready") {
      void loadActiveProfile();
    }
  }, [booted, activeProfileId, profile.settled, profile.value, repoMode]);

  // Model_Router refresh on start, Profile change, and provider config change (6.4, 6.16).
  const s = settings.value;
  const routerKey = s ? `${s.profileId}\u0000${s.providerMode}\u0000${s.ollamaBaseUrl}\u0000${s.ollamaModel}` : null;
  const settingsRef = useRef(s);
  useEffect(() => {
    settingsRef.current = s;
  });
  useEffect(() => {
    const current = settingsRef.current;
    if (!routerKey || !current) return;
    void modelRouter.refresh(current).catch(() => undefined);
  }, [routerKey]);

  // Summary regeneration pending from an earlier session (10.9).
  const regenerated = useRef(new Set<string>());
  useEffect(() => {
    if (!booted || repoMode !== "ready" || !activeProfileId) return;
    if (regenerated.current.has(activeProfileId)) return;
    regenerated.current.add(activeProfileId);
    void regenerateIfStale(activeProfileId).catch(() => undefined);
  }, [booted, repoMode, activeProfileId]);

  const refresh = useCallback(async () => {
    await loadActiveProfile();
    const current = settingsRef.current;
    if (current) await modelRouter.refresh(current).catch(() => undefined);
  }, []);

  const dismissPersist = useCallback(() => setPersistDenied(false), []);
  const dismissUsage = useCallback(() => setUsagePercent(null), []);

  const value = useMemo<AppState>(
    () => ({
      repoMode,
      activeProfile: profile.value,
      settings: settings.value,
      profileMeta: profileMeta.value,
      refresh,
      checkStorage,
      storage: { persistDenied, usagePercent, dismissPersist, dismissUsage },
    }),
    [
      repoMode,
      profile.value,
      settings.value,
      profileMeta.value,
      refresh,
      checkStorage,
      persistDenied,
      usagePercent,
      dismissPersist,
      dismissUsage,
    ],
  );

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  let content: ReactNode;
  if (!booted || !profile.settled || !settings.settled || !profileMeta.settled) {
    content = <AppSkeleton />;
  } else if (!activeProfileId) {
    content = <ProfileOnboarding repoMode={repoMode} />;
  } else if (!profile.value) {
    // Re-picking the Active_Profile (see effect above).
    content = <AppSkeleton />;
  } else if (!settings.value) {
    content = (
      <div className="mx-auto max-w-lg px-6 py-16">
        <InlineAlert tone="danger" title="Your data could not be loaded">
          The settings for this profile are missing. Your stored data was not changed. Try reloading the page.
        </InlineAlert>
      </div>
    );
  } else {
    const consentPending = repoMode === "ready" && profileMeta.value?.activityConsent === null;
    content = (
      <>
        {children}
        <ActivityDisclosureDialog key={profile.value.id} profileId={profile.value.id} open={consentPending} />
        <BreakSuggestionToast />
      </>
    );
  }

  return (
    <AppContext.Provider value={value}>
      <TabSync repo={repo} />
      {content}
    </AppContext.Provider>
  );
}

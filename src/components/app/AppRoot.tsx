"use client";

/**
 * AppRoot (design "Rendering and hydration strategy"; Req 1.5, 1.6, 16.2,
 * 16.7, 16.8, 20.19, 20.20, 22.10).
 *
 * Once a user is signed in, it opens that user's Local_Store
 * (`companion-<userId>`, running migrations) inside `useEffect`, loads the
 * browser record and the Active_Profile, then starts the Tab_Coordinator
 * (scoped to the user), Activity_Tracker, Check_In_Scheduler, and service
 * worker. Nothing touches IndexedDB before the user id is known, and the
 * Public_Auth_Pages render without booting at all. A different user signing
 * in tears the previous user's runtime down first. Until boot is done it
 * renders a static skeleton that is identical on server and client.
 */
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { useAuth } from "@/components/auth/AuthProvider";
import type { StoreName } from "@/core/models";
import { initRepo, userDbName, type Repo, type RepoMode } from "@/data/repository";
import { isPublicAuthPath } from "@/lib/authPaths";
import { localTeardownSettled, teardownLocalData } from "@/services/localSession";
import { useLiveQuery } from "@/data/useLiveQuery";
import { startActivityTracker } from "@/services/activityTracker";
import { regenerateIfStale } from "@/services/memoryService";
import { modelRouter } from "@/services/modelRouter";
import { onOpenCall, registerServiceWorker, serviceWorkerSupported } from "@/services/notifications";
import { loadActiveProfile } from "@/services/profileService";
import { attachAudioPrimer, stopRingtone } from "@/services/ringtone";
import { startScheduler } from "@/services/scheduler";
import { getServerSession, getSession, subscribeSession } from "@/services/session";
import { acknowledgeGeminiNotice, ensureBrowserRecord } from "@/services/settingsService";
import { startTabCoordinator } from "@/services/tabCoordinator";
import { reconcile, seedPrimaryProfile, setPreferencesSyncUser } from "@/services/preferencesSync";
import { useIsLeader } from "@/services/useTabState";
import { getBrowserSupabase } from "@/lib/supabase/client";
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
  const pathname = usePathname() ?? "/";
  const onAuthPage = isPublicAuthPath(pathname);
  const auth = useAuth();
  const userId = auth.status === "signed_in" ? (auth.user?.id ?? null) : null;
  const authUserRef = useRef(auth.user);
  useEffect(() => {
    authUserRef.current = auth.user;
  });
  const leader = useIsLeader();

  const [repo, setRepo] = useState<Repo | null>(null);
  /** The user id the runtime was booted for; boot is "done" only for the current user. */
  const [bootedFor, setBootedFor] = useState<string | null>(null);
  const booted = userId !== null && bootedFor === userId;
  /** User whose runtime is started (or starting) in this tab. */
  const runtimeUser = useRef<string | null>(null);
  /** User whose preferences were reconciled in this tab (reset on sign-out). */
  const reconciledFor = useRef<string | null>(null);
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
    if (!userId) {
      // Signed out (or not known yet). Sign-out teardown is run by the
      // AuthProvider; here we only drop references to the closed Local_Store.
      if (auth.status === "signed_out") {
        runtimeUser.current = null;
        reconciledFor.current = null;
        setRepo(null);
        setBootedFor(null);
      }
      return;
    }
    // Auth pages (e.g. a /reset-password recovery visit) never boot the DB.
    if (onAuthPage && runtimeUser.current !== userId) return;

    let cancelled = false;
    (async () => {
      const previous = runtimeUser.current;
      runtimeUser.current = userId;
      if (previous && previous !== userId) {
        // Different user in this tab: stop the previous user's runtime first.
        setBootedFor(null);
        setRepo(null);
        await teardownLocalData();
        if (cancelled) return;
      }
      // Never open while a teardown (sign-out, user switch) is still closing the DB.
      await localTeardownSettled();
      if (cancelled) return;

      let opened: Repo | null = null;
      try {
        opened = await initRepo({ dbName: userDbName(userId) });
      } catch {
        opened = null;
      }
      if (cancelled) return;
      setRepo(opened);

      if (opened && opened.mode !== "unavailable") {
        await ensureBrowserRecord();
        // Preferences_Sync (22.12): a fresh Local_Store gets its Primary_Profile
        // from the account's preferences (or the signup name).
        const user = authUserRef.current;
        const sb = getBrowserSupabase();
        if (user && user.id === userId && sb) {
          await seedPrimaryProfile(opened, sb, user).catch(() => undefined);
          if (cancelled) return;
          setPreferencesSyncUser(user);
        }
        await loadActiveProfile();
      }
      if (cancelled) return;

      // All of these are idempotent (per user) and SSR-safe.
      startTabCoordinator(userId);
      startActivityTracker();
      startScheduler();
      if (serviceWorkerSupported()) void registerServiceWorker();
      void requestPersistence();
      void checkStorage();

      setBootedFor(userId);
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, auth.status, onAuthPage, checkStorage, requestPersistence]);

  // Gemini_Privacy_Notice acceptance is stored per Profile (6.21).
  useEffect(() => {
    modelRouter.setAcknowledgeHandler(async (profileId) => {
      await acknowledgeGeminiNotice(profileId);
    });
    return () => modelRouter.setAcknowledgeHandler(null);
  }, []);

  // Notification click → open the call screen (13.4).
  useEffect(() => onOpenCall((url) => router.push(url)), [router]);

  // Unlock Web Audio on the first gesture so a later ring may play (autoplay policy).
  useEffect(() => attachAudioPrimer(), []);

  // Answering (opening /call) stops the ringtone.
  useEffect(() => {
    if (pathname === "/call" || pathname.startsWith("/call/")) stopRingtone();
  }, [pathname]);

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

  // Preferences_Sync startup last-write-wins (22.14), once per sign-in, leader tab only.
  useEffect(() => {
    if (!booted || !leader || repoMode !== "ready" || !userId || !repo) return;
    if (reconciledFor.current === userId) return;
    const user = authUserRef.current;
    const sb = getBrowserSupabase();
    if (!user || user.id !== userId || !sb) return;
    reconciledFor.current = userId;
    void reconcile(repo, sb, user).catch(() => undefined);
  }, [booted, leader, repoMode, userId, repo]);

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

  // Public_Auth_Pages render on their own: no Local_Store, no app chrome.
  if (onAuthPage) return <>{children}</>;

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

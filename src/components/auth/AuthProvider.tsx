"use client";

/**
 * Auth_Service state for the whole app (design "Authentication (Req 22)").
 *
 * On mount it verifies the session with `auth.getUser()` and then follows
 * `onAuthStateChange`. `signOut()` (22.4) ends any active call (awaiting the
 * transcript save), stops the Check_In_Scheduler, Activity_Tracker and
 * Tab_Coordinator, closes the user's Local_Store, signs out of Supabase, and
 * opens /login. A `SIGNED_OUT` event from another tab runs the same teardown.
 */
import { isAuthApiError, type User } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { isPublicAuthPath } from "@/lib/authPaths";
import { getBrowserSupabase } from "@/lib/supabase/client";
import { teardownLocalData } from "@/services/localSession";

export type AuthStatus = "loading" | "signed_in" | "signed_out";

export interface AuthState {
  status: AuthStatus;
  /** The signed-in Supabase user; null unless `status === "signed_in"`. */
  user: User | null;
  /** True after a `PASSWORD_RECOVERY` event (the user arrived from a reset email). */
  passwordRecovery: boolean;
  /** Full sign-out (22.4). Resolves after navigation to /login has been requested. */
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

type Snapshot = { status: AuthStatus; user: User | null };

const LOADING: Snapshot = { status: "loading", user: null };
const SIGNED_OUT: Snapshot = { status: "signed_out", user: null };

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  const [snap, setSnap] = useState<Snapshot>(LOADING);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  /** Set while this tab runs `signOut()`, so its own SIGNED_OUT event isn't handled twice. */
  const signingOut = useRef(false);

  const applyUser = useCallback((user: User | null) => {
    setSnap((prev) => {
      if (!user) return prev.status === "signed_out" ? prev : SIGNED_OUT;
      // Keep the snapshot stable when nothing that consumers read has changed.
      if (prev.status === "signed_in" && prev.user?.id === user.id && prev.user.email === user.email) {
        const prevName = prev.user.user_metadata?.display_name;
        if (prevName === user.user_metadata?.display_name) return prev;
      }
      return { status: "signed_in", user };
    });
  }, []);

  /**
   * Teardown after a sign-out that happened elsewhere (another tab, expired
   * session). The signed-out effect below then opens /login.
   */
  const handleRemoteSignOut = useCallback(async () => {
    await teardownLocalData();
    setPasswordRecovery(false);
    applyUser(null);
  }, [applyUser]);

  useEffect(() => {
    const sb = getBrowserSupabase();
    if (!sb) {
      setSnap(SIGNED_OUT);
      return;
    }
    let active = true;

    void (async () => {
      try {
        const { data, error } = await sb.auth.getUser();
        if (!active) return;
        if (data.user) {
          applyUser(data.user);
        } else if (error && !isAuthApiError(error)) {
          // Offline or Supabase unreachable: trust the stored session so the
          // local-first app keeps working; the server still verifies on API calls.
          const { data: s } = await sb.auth.getSession();
          if (active) applyUser(s.session?.user ?? null);
        } else {
          applyUser(null);
        }
      } catch {
        if (active) applyUser(null);
      }
    })();

    const {
      data: { subscription },
    } = sb.auth.onAuthStateChange((event, session) => {
      // Never await Supabase calls inside this callback (it can deadlock the
      // client's auth lock); defer the work to the next task instead.
      setTimeout(() => {
        if (!active) return;
        switch (event) {
          case "INITIAL_SESSION":
            // `getUser()` above is authoritative for the first state.
            return;
          case "SIGNED_OUT":
            if (!signingOut.current) void handleRemoteSignOut();
            return;
          case "PASSWORD_RECOVERY":
            setPasswordRecovery(true);
            applyUser(session?.user ?? null);
            return;
          default:
            if (session?.user) applyUser(session.user);
        }
      }, 0);
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [applyUser, handleRemoteSignOut]);

  // Signed out (e.g. the session expired) on a protected page: go to /login.
  useEffect(() => {
    if (snap.status !== "signed_out" || signingOut.current || isPublicAuthPath(pathname)) return;
    if (!getBrowserSupabase()) return;
    const next = `${pathname}${window.location.search}`;
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [snap.status, pathname, router]);

  const signOut = useCallback(async () => {
    signingOut.current = true;
    try {
      await teardownLocalData();
      const sb = getBrowserSupabase();
      if (sb) {
        try {
          await sb.auth.signOut({ scope: "local" });
        } catch {
          // Local session is cleared even if the revoke request fails.
        }
      }
      setPasswordRecovery(false);
      applyUser(null);
      router.replace("/login");
    } finally {
      // Let this tab's own deferred SIGNED_OUT callback see the flag first.
      setTimeout(() => {
        signingOut.current = false;
      }, 50);
    }
  }, [applyUser, router]);

  const value = useMemo<AuthState>(
    () => ({ status: snap.status, user: snap.user, passwordRecovery, signOut }),
    [snap, passwordRecovery, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Auth state. Throws outside `<AuthProvider>`. */
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

/** Auth state, or null outside `<AuthProvider>`. */
export function useOptionalAuth(): AuthState | null {
  return useContext(AuthContext);
}

/** Display name stored at signup (`options.data.display_name`), if any. */
export function signupDisplayName(user: User | null): string | null {
  const raw: unknown = user?.user_metadata?.display_name;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

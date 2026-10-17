"use client";

/**
 * Live queries over the repository (Req 16.1, 20.4).
 *
 * `useLiveQuery(query, stores, deps)` runs `query` after mount and whenever
 * `deps` change, and re-runs it whenever a committed repository change touches
 * one of `stores`. SSR-safe: the query only runs inside `useEffect`, so the
 * server render (and the first client render) is always `{ loading: true }`.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type DependencyList,
} from "react";
import type { StoreName } from "@/core/models";
import { getRepo, subscribeRepo, type Repo } from "./repository";

/** Optional override (e.g. for an isolated subtree); defaults to the shared instance from `initRepo`. */
export const RepoContext = createContext<Repo | null>(null);

const getServerRepo = (): Repo | null => null;

/** The Repo from context, else the shared instance; `null` until `initRepo` resolves (and on the server). */
export function useRepo(): Repo | null {
  const fromContext = useContext(RepoContext);
  const shared = useSyncExternalStore(subscribeRepo, getRepo, getServerRepo);
  return fromContext ?? shared;
}

export interface LiveQueryState<T> {
  data: T | undefined;
  error: unknown;
  loading: boolean;
}

export function useLiveQuery<T>(
  query: () => Promise<T>,
  stores: readonly StoreName[],
  deps: DependencyList = [],
): LiveQueryState<T> {
  const repo = useRepo();
  const [state, setState] = useState<LiveQueryState<T>>({ data: undefined, error: undefined, loading: true });
  const [version, setVersion] = useState(0);

  // Always call the latest closure; declared first so it updates before the run effect.
  const queryRef = useRef(query);
  useEffect(() => {
    queryRef.current = query;
  });

  const storeKey = [...stores].sort().join("|");

  useEffect(() => {
    if (!repo) return;
    const watched = new Set(storeKey.split("|"));
    return repo.onChange((event) => {
      if (event.stores.some((s) => watched.has(s))) setVersion((v) => v + 1);
    });
  }, [repo, storeKey]);

  useEffect(() => {
    // Stay in `loading` until the Repo is available.
    if (!repo) return;
    let cancelled = false;
    setState((s) => (s.loading ? s : { ...s, loading: true }));
    queryRef.current().then(
      (data) => {
        if (!cancelled) setState({ data, error: undefined, loading: false });
      },
      (error: unknown) => {
        if (!cancelled) setState((s) => ({ data: s.data, error, loading: false }));
      },
    );
    return () => {
      cancelled = true;
    };
    // `deps` is the caller's dependency list for `query`; `version` bumps on relevant commits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, version, ...deps]);

  return state;
}

"use client";

import { useEffect, useState } from "react";
import type { Bootstrap, EntryData, Fixture, PlayerHistories } from "./types";

// Session-lived cache so navigating between pages doesn't refetch.
const jsonCache = new Map<string, unknown>();

interface JsonState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

function initialState<T>(url: string | null): JsonState<T> {
  const cached = url ? (jsonCache.get(url) as T | undefined) : undefined;
  return {
    data: cached ?? null,
    error: null,
    loading: url !== null && cached === undefined,
  };
}

export function useJson<T>(url: string | null): JsonState<T> {
  const [state, setState] = useState<JsonState<T>>(() => initialState<T>(url));
  const [trackedUrl, setTrackedUrl] = useState(url);

  // When the url changes, reset state during render rather than in an effect —
  // React applies this before painting and skips the extra render pass.
  if (url !== trackedUrl) {
    setTrackedUrl(url);
    setState(initialState<T>(url));
  }

  useEffect(() => {
    // initialState already populated data on a cache hit and set loading only
    // on a miss, so only a genuine miss needs a fetch here.
    if (!url || jsonCache.has(url)) return;

    let cancelled = false;
    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        return res.json() as Promise<T>;
      })
      .then((data) => {
        jsonCache.set(url, data);
        if (!cancelled) setState({ data, error: null, loading: false });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ data: null, error: err.message, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  return state;
}

export const useBootstrap = () => useJson<Bootstrap>("/api/fpl/bootstrap");
export const useFixtures = () => useJson<Fixture[]>("/api/fpl/fixtures");
export const useEntry = (teamId: number | null) =>
  useJson<EntryData>(teamId ? `/api/fpl/entry/${teamId}` : null);

/**
 * Recent per-match history for a set of players. Ids are sorted so the same
 * set produces the same url however the caller ordered it, which keeps the
 * session cache hitting. Costs one upstream request per id — pass a squad or
 * a shortlist, never the whole market.
 */
export const usePlayerHistories = (ids: number[]) =>
  useJson<PlayerHistories>(
    ids.length > 0
      ? `/api/fpl/players?ids=${[...ids].sort((a, b) => a - b).join(",")}`
      : null,
  );

const TEAM_ID_KEY = "fpl-team-id";

export function useTeamId(): [number | null, (id: number | null) => void, boolean] {
  const [teamId, setTeamIdState] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem(TEAM_ID_KEY);
    return stored ? parseInt(stored, 10) || null : null;
  });
  // `ready` stays false through the first (server-matching) render and flips
  // after mount, so consumers can gate on it and avoid a hydration mismatch.
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Detecting that we've mounted on the client is the one thing that
    // genuinely requires an effect setState — there's no render-phase signal
    // for it — so the cascading-render rule doesn't apply.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setReady(true);
  }, []);

  const setTeamId = (id: number | null) => {
    if (id) localStorage.setItem(TEAM_ID_KEY, String(id));
    else localStorage.removeItem(TEAM_ID_KEY);
    setTeamIdState(id);
  };

  return [teamId, setTeamId, ready];
}

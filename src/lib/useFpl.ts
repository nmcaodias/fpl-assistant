"use client";

import { useEffect, useState } from "react";
import type { Bootstrap, EntryData, Fixture } from "./types";

// Session-lived cache so navigating between pages doesn't refetch.
const jsonCache = new Map<string, unknown>();

interface JsonState<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
}

export function useJson<T>(url: string | null): JsonState<T> {
  const cached = url ? (jsonCache.get(url) as T | undefined) : undefined;
  const [state, setState] = useState<JsonState<T>>({
    data: cached ?? null,
    error: null,
    loading: url !== null && cached === undefined,
  });

  useEffect(() => {
    if (!url) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const hit = jsonCache.get(url) as T | undefined;
    if (hit !== undefined) {
      setState({ data: hit, error: null, loading: false });
      return;
    }
    let cancelled = false;
    setState({ data: null, error: null, loading: true });
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

const TEAM_ID_KEY = "fpl-team-id";

export function useTeamId(): [number | null, (id: number | null) => void, boolean] {
  const [teamId, setTeamIdState] = useState<number | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(TEAM_ID_KEY);
    if (stored) setTeamIdState(parseInt(stored, 10) || null);
    setReady(true);
  }, []);

  const setTeamId = (id: number | null) => {
    if (id) localStorage.setItem(TEAM_ID_KEY, String(id));
    else localStorage.removeItem(TEAM_ID_KEY);
    setTeamIdState(id);
  };

  return [teamId, setTeamId, ready];
}

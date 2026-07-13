// Server-side client for the official FPL API, with a small in-memory TTL
// cache. Runs only in route handlers — the FPL API blocks browser CORS, so
// everything is proxied through /api/fpl/*.

const BASE = "https://fantasy.premierleague.com/api";
const TTL_MS = 5 * 60 * 1000;

const cache = new Map<string, { at: number; data: unknown }>();

export class FplError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function fpl<T>(path: string): Promise<T> {
  const hit = cache.get(path);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data as T;

  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": "Mozilla/5.0 (fpl-assistant)" },
    // We cache ourselves; keep Next's fetch cache out of the way.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new FplError(`FPL API ${res.status} for ${path}`, res.status);
  }
  const data = (await res.json()) as T;
  cache.set(path, { at: Date.now(), data });
  return data;
}

// --- Upstream shapes (only the fields we read) ---

interface RawBootstrap {
  events: Record<string, unknown>[];
  teams: Record<string, unknown>[];
  elements: Record<string, unknown>[];
}

const PLAYER_FIELDS = [
  "id",
  "web_name",
  "first_name",
  "second_name",
  "team",
  "element_type",
  "now_cost",
  "total_points",
  "points_per_game",
  "form",
  "ep_next",
  "selected_by_percent",
  "status",
  "chance_of_playing_next_round",
  "news",
  "minutes",
  "goals_scored",
  "assists",
  "clean_sheets",
  "bonus",
  "starts",
] as const;

const TEAM_FIELDS = ["id", "name", "short_name", "strength"] as const;

const EVENT_FIELDS = [
  "id",
  "name",
  "deadline_time",
  "finished",
  "is_current",
  "is_next",
] as const;

function pick<K extends string>(obj: Record<string, unknown>, keys: readonly K[]) {
  const out: Record<string, unknown> = {};
  for (const k of keys) out[k] = obj[k];
  return out;
}

export async function getBootstrap() {
  const raw = await fpl<RawBootstrap>("/bootstrap-static/");
  return {
    players: raw.elements.map((e) => pick(e, PLAYER_FIELDS)),
    teams: raw.teams.map((t) => pick(t, TEAM_FIELDS)),
    events: raw.events.map((e) => pick(e, EVENT_FIELDS)),
  };
}

const FIXTURE_FIELDS = [
  "id",
  "event",
  "team_h",
  "team_a",
  "team_h_difficulty",
  "team_a_difficulty",
  "kickoff_time",
  "finished",
  "team_h_score",
  "team_a_score",
] as const;

export async function getFixtures() {
  const raw = await fpl<Record<string, unknown>[]>("/fixtures/");
  return raw.map((f) => pick(f, FIXTURE_FIELDS));
}

interface RawEntry {
  id: number;
  name: string;
  player_first_name: string;
  player_last_name: string;
  summary_overall_points: number | null;
  summary_overall_rank: number | null;
  summary_event_points: number | null;
  current_event: number | null;
}

interface RawPicks {
  active_chip: string | null;
  entry_history: {
    event: number;
    points: number;
    total_points: number;
    overall_rank: number;
    bank: number;
    value: number;
    event_transfers: number;
    points_on_bench: number;
  };
  picks: {
    element: number;
    position: number;
    multiplier: number;
    is_captain: boolean;
    is_vice_captain: boolean;
  }[];
}

interface RawHistory {
  chips: { name: string; event: number }[];
}

export async function getEntry(id: number) {
  const entry = await fpl<RawEntry>(`/entry/${id}/`);

  let picks: RawPicks | null = null;
  if (entry.current_event) {
    try {
      picks = await fpl<RawPicks>(`/entry/${id}/event/${entry.current_event}/picks/`);
    } catch {
      // Picks can be missing right after a season rollover; the entry itself
      // is still useful.
    }
  }

  let chips: { name: string; event: number }[] = [];
  try {
    chips = (await fpl<RawHistory>(`/entry/${id}/history/`)).chips ?? [];
  } catch {
    // Non-essential.
  }

  return {
    entry: {
      id: entry.id,
      name: entry.name,
      player_first_name: entry.player_first_name,
      player_last_name: entry.player_last_name,
      summary_overall_points: entry.summary_overall_points,
      summary_overall_rank: entry.summary_overall_rank,
      summary_event_points: entry.summary_event_points,
      current_event: entry.current_event,
    },
    picks: picks?.picks ?? null,
    entryHistory: picks?.entry_history ?? null,
    activeChip: picks?.active_chip ?? null,
    chipsUsed: chips,
  };
}

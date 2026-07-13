// Shapes returned by our /api/fpl/* routes — trimmed versions of the official
// FPL API responses (https://fantasy.premierleague.com/api).

export type Position = 1 | 2 | 3 | 4;

export const POSITION_NAMES: Record<Position, string> = {
  1: "GKP",
  2: "DEF",
  3: "MID",
  4: "FWD",
};

export interface Team {
  id: number;
  name: string;
  short_name: string;
  strength: number;
}

export interface Event {
  id: number;
  name: string;
  deadline_time: string;
  finished: boolean;
  is_current: boolean;
  is_next: boolean;
}

export interface Player {
  id: number;
  web_name: string;
  first_name: string;
  second_name: string;
  team: number;
  element_type: Position;
  /** Price in tenths of £m (e.g. 147 = £14.7m) */
  now_cost: number;
  total_points: number;
  /** Numeric strings in the FPL API */
  points_per_game: string;
  form: string;
  ep_next: string;
  selected_by_percent: string;
  /** a=available, d=doubtful, i=injured, s=suspended, u=unavailable, n=not in squad */
  status: string;
  chance_of_playing_next_round: number | null;
  news: string;
  minutes: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  bonus: number;
  starts: number;
}

export interface Bootstrap {
  players: Player[];
  teams: Team[];
  events: Event[];
}

export interface Fixture {
  id: number;
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_difficulty: number;
  team_a_difficulty: number;
  kickoff_time: string | null;
  finished: boolean;
  team_h_score: number | null;
  team_a_score: number | null;
}

export interface SquadPick {
  element: number;
  position: number; // 1-11 starters, 12-15 bench
  multiplier: number; // 0 bench, 1 playing, 2 captain, 3 triple captain
  is_captain: boolean;
  is_vice_captain: boolean;
}

export interface EntryData {
  entry: {
    id: number;
    name: string;
    player_first_name: string;
    player_last_name: string;
    summary_overall_points: number | null;
    summary_overall_rank: number | null;
    summary_event_points: number | null;
    current_event: number | null;
  };
  /** Picks for the entry's latest gameweek, null if none played yet */
  picks: SquadPick[] | null;
  entryHistory: {
    event: number;
    points: number;
    total_points: number;
    overall_rank: number;
    /** Tenths of £m; value includes bank */
    bank: number;
    value: number;
    event_transfers: number;
    points_on_bench: number;
  } | null;
  activeChip: string | null;
  chipsUsed: { name: string; event: number }[];
}

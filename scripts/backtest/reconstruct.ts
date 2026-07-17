/**
 * Rebuild the engine's inputs as they would have looked *before* a given
 * gameweek, from that season's actuals alone — the core of an honest
 * walk-forward. For gameweek N nothing from round >= N is ever read to build a
 * projection; only rounds 1..N-1 feed the rates, and round N is used solely as
 * the answer key.
 *
 * Three real inputs can't be reconstructed from history and are neutralised:
 *   - status / chance_of_playing: no historical injury feed, so everyone is
 *     assumed available. The backtest therefore can't judge the availability
 *     model — a genuinely injured player reads as a projection miss.
 *   - ep_next: FPL's own model output isn't in the archive, so its anchor is
 *     switched off (ep_next = "0").
 * What remains — rates, minutes, fixtures, form, the recent-window blend — is
 * exactly the engine's core, run through the real projection.ts code.
 */
import { readFileSync } from "node:fs";
import { buildProjectionContext, summariseRecent } from "../../src/lib/projection";
import type { RecentWindow } from "../../src/lib/projection";
import type {
  Event,
  Fixture,
  HistoryRow,
  Player,
  Position,
  Team,
} from "../../src/lib/types";
import { DATA_DIR } from "./config";

/** Matches making up the trailing form number (mirrors FPL's ~30-day window). */
const FORM_WINDOW = 4;
/** Recent-window length for the Phase 2 blend, matching the app. */
const RECENT_MATCHES = 5;
const TOTAL_GWS = 38;

interface RawHistoryRow {
  round: number;
  minutes: number;
  starts: number;
  expected_goals: string;
  expected_assists: string;
  defensive_contribution: number;
  saves: number;
  bonus: number;
  total_points: number;
  value: number;
}

interface RawFixture {
  id: number;
  event: number | null;
  team_h: number;
  team_a: number;
  team_h_difficulty: number;
  team_a_difficulty: number;
  team_h_score: number | null;
  team_a_score: number | null;
}

interface PlayerMeta {
  id: number;
  web_name: string;
  team: number;
  element_type: Position;
}

export interface BacktestData {
  metaById: Map<number, PlayerMeta>;
  /** Every in-scope player's rows, sorted by round ascending. */
  historyById: Map<number, RawHistoryRow[]>;
  rawFixtures: RawFixture[];
  teams: Team[];
}

const num = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

export function loadData(): BacktestData {
  const read = <T>(name: string): T =>
    JSON.parse(readFileSync(`${DATA_DIR}/${name}.json`, "utf8")) as T;

  const bootstrap = read<{
    elements: (PlayerMeta & Record<string, unknown>)[];
    teams: (Team & Record<string, unknown>)[];
  }>("bootstrap");
  const histories = read<Record<string, RawHistoryRow[]>>("histories");
  const rawFixtures = read<RawFixture[]>("fixtures");

  const metaById = new Map<number, PlayerMeta>();
  for (const e of bootstrap.elements) {
    metaById.set(e.id, {
      id: e.id,
      web_name: e.web_name,
      team: e.team,
      element_type: e.element_type,
    });
  }

  const historyById = new Map<number, RawHistoryRow[]>();
  for (const [id, rows] of Object.entries(histories)) {
    historyById.set(
      Number(id),
      [...rows].sort((a, b) => a.round - b.round),
    );
  }

  const teams: Team[] = bootstrap.teams.map((t) => ({
    id: t.id,
    name: t.name,
    short_name: t.short_name,
    strength: t.strength,
  }));

  return { metaById, historyById, rawFixtures, teams };
}

/** The season schedule as it stood before gameweek `gw`: earlier rounds marked
 * finished with their real scores, `gw` onward still to play. */
function fixturesAsOf(raw: RawFixture[], gw: number): Fixture[] {
  return raw.map((f) => ({
    id: f.id,
    event: f.event,
    team_h: f.team_h,
    team_a: f.team_a,
    team_h_difficulty: f.team_h_difficulty,
    team_a_difficulty: f.team_a_difficulty,
    kickoff_time: null,
    finished: f.event !== null && f.event < gw,
    team_h_score: f.team_h_score,
    team_a_score: f.team_a_score,
  }));
}

function eventsAsOf(gw: number): Event[] {
  return Array.from({ length: TOTAL_GWS }, (_, i) => {
    const id = i + 1;
    return {
      id,
      name: `GW${id}`,
      deadline_time: "",
      finished: id < gw,
      is_current: id === gw - 1,
      is_next: id === gw,
    };
  });
}

const toHistoryRow = (r: RawHistoryRow): HistoryRow => ({
  round: r.round,
  minutes: r.minutes,
  starts: r.starts,
  expected_goals: r.expected_goals,
  expected_assists: r.expected_assists,
  defensive_contribution: r.defensive_contribution,
  saves: r.saves,
  bonus: r.bonus,
  total_points: r.total_points,
});

/**
 * A Player as known before gameweek `gw`: per-90 rates, minutes, form, and
 * price all rebuilt from rounds < gw. Returns null when the player has no
 * football yet (no denominator to project from).
 */
function playerAsOf(meta: PlayerMeta, rows: RawHistoryRow[], gw: number): Player | null {
  const prior = rows.filter((r) => r.round < gw);
  const minutes = prior.reduce((s, r) => s + r.minutes, 0);
  if (minutes === 0) return null;

  const appearances = prior.filter((r) => r.minutes > 0).length;
  const per90 = (total: number) => (total / minutes) * 90;
  const sum = (f: (r: RawHistoryRow) => number) => prior.reduce((s, r) => s + f(r), 0);

  const totalPoints = sum((r) => r.total_points);
  const formRows = prior.slice(-FORM_WINDOW);
  const form =
    formRows.length > 0
      ? formRows.reduce((s, r) => s + r.total_points, 0) / formRows.length
      : 0;
  // Most recent price on record before this gameweek.
  const now_cost = prior[prior.length - 1]?.value ?? 0;

  const xg90 = per90(sum((r) => num(r.expected_goals)));
  const xa90 = per90(sum((r) => num(r.expected_assists)));

  return {
    id: meta.id,
    web_name: meta.web_name,
    first_name: "",
    second_name: "",
    team: meta.team,
    element_type: meta.element_type,
    now_cost,
    total_points: totalPoints,
    points_per_game: appearances > 0 ? (totalPoints / appearances).toFixed(1) : "0.0",
    form: form.toFixed(1),
    ep_next: "0", // FPL's own projection isn't in the archive — anchor disabled
    selected_by_percent: "0.0",
    status: "a", // no historical injury feed — everyone assumed available
    chance_of_playing_next_round: null,
    news: "",
    minutes,
    goals_scored: 0,
    assists: 0,
    clean_sheets: 0,
    bonus: sum((r) => r.bonus),
    starts: sum((r) => r.starts),
    expected_goals: "0.0",
    expected_assists: "0.0",
    expected_goal_involvements: "0.0",
    expected_goals_per_90: xg90,
    expected_assists_per_90: xa90,
    expected_goal_involvements_per_90: xg90 + xa90,
    saves_per_90: per90(sum((r) => r.saves)),
    defensive_contribution_per_90: per90(sum((r) => r.defensive_contribution)),
  };
}

export interface GwInputs {
  gw: number;
  players: Player[];
  ctx: ReturnType<typeof buildProjectionContext>;
  recent: Map<number, RecentWindow>;
  priorAppearances: Map<number, number>;
}

/** Everything the engine needs to project gameweek `gw`, no lookahead. */
export function reconstructGw(data: BacktestData, gw: number): GwInputs {
  const players: Player[] = [];
  const recent = new Map<number, RecentWindow>();
  const priorAppearances = new Map<number, number>();

  for (const [id, rows] of data.historyById) {
    const meta = data.metaById.get(id);
    if (!meta) continue;
    const player = playerAsOf(meta, rows, gw);
    if (!player) continue;
    players.push(player);

    const prior = rows.filter((r) => r.round < gw);
    priorAppearances.set(id, prior.filter((r) => r.minutes > 0).length);
    const window = prior.slice(-RECENT_MATCHES).map(toHistoryRow);
    if (window.length > 0) recent.set(id, summariseRecent(window));
  }

  const ctx = buildProjectionContext(
    fixturesAsOf(data.rawFixtures, gw),
    eventsAsOf(gw),
    data.teams,
  );

  return { gw, players, ctx, recent, priorAppearances };
}

/** Actual return for a player in a single gameweek — summed over both fixtures
 * of a double, zero for a blank or a gameweek they weren't in the data for. */
export function actualForGw(
  data: BacktestData,
  playerId: number,
  gw: number,
): { points: number; minutes: number; appeared: boolean } {
  const rows = (data.historyById.get(playerId) ?? []).filter((r) => r.round === gw);
  const points = rows.reduce((s, r) => s + r.total_points, 0);
  const minutes = rows.reduce((s, r) => s + r.minutes, 0);
  return { points, minutes, appeared: minutes > 0 };
}

/** Actual points a player scored across gameweeks `gw`..`gw+horizon-1`. */
export function actualOverHorizon(
  data: BacktestData,
  playerId: number,
  gw: number,
  horizon: number,
): number {
  let total = 0;
  for (let g = gw; g < gw + horizon && g <= TOTAL_GWS; g++) {
    total += actualForGw(data, playerId, g).points;
  }
  return total;
}

export { TOTAL_GWS };

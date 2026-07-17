// Expected-points (xPts) engine.
//
// Projects each player's points per future gameweek from underlying rates —
// xG/xA per 90, team goals conceded (clean-sheet odds via Poisson), saves,
// defensive contributions, bonus rate — scaled by projected minutes and
// adjusted per fixture by FPL's difficulty rating. Double gameweeks sum both
// fixtures; blanks are zero. This is what "thinking like a top manager" means
// mechanically: decisions compare points over a horizon, not abstract scores.

import type { Event, Fixture, HistoryRow, Player, PlayerHistories, Position, Team } from "./types";

export interface UpcomingFixture {
  event: number;
  opponent: number;
  isHome: boolean;
  difficulty: number; // FPL FDR, 1 (easiest) to 5 (hardest)
}

export interface ProjectionContext {
  nextGw: number | null;
  lastGw: number;
  upcomingByTeam: Record<number, UpcomingFixture[]>;
  /** Goals conceded per match this season, per team (clean-sheet baseline) */
  concededPerMatch: Record<number, number>;
  /** Finished matches per team (minutes baseline) */
  gamesPlayed: Record<number, number>;
  seasonFinished: boolean;
}

export function buildProjectionContext(
  fixtures: Fixture[],
  events: Event[],
  teams: Team[],
): ProjectionContext {
  const next = events.find((e) => e.is_next) ?? events.find((e) => !e.finished);
  const nextGw = next?.id ?? null;
  const lastGw = events.length > 0 ? Math.max(...events.map((e) => e.id)) : 38;

  const upcomingByTeam: Record<number, UpcomingFixture[]> = {};
  if (nextGw !== null) {
    const upcoming = fixtures
      .filter((f) => !f.finished && f.event !== null && f.event >= nextGw)
      .sort((a, b) => (a.event ?? 0) - (b.event ?? 0));
    for (const f of upcoming) {
      (upcomingByTeam[f.team_h] ??= []).push({
        event: f.event as number,
        opponent: f.team_a,
        isHome: true,
        difficulty: f.team_h_difficulty,
      });
      (upcomingByTeam[f.team_a] ??= []).push({
        event: f.event as number,
        opponent: f.team_h,
        isHome: false,
        difficulty: f.team_a_difficulty,
      });
    }
  }

  const conceded: Record<number, number> = {};
  const games: Record<number, number> = {};
  for (const f of fixtures) {
    if (!f.finished || f.team_h_score === null || f.team_a_score === null) continue;
    conceded[f.team_h] = (conceded[f.team_h] ?? 0) + f.team_a_score;
    conceded[f.team_a] = (conceded[f.team_a] ?? 0) + f.team_h_score;
    games[f.team_h] = (games[f.team_h] ?? 0) + 1;
    games[f.team_a] = (games[f.team_a] ?? 0) + 1;
  }
  const concededPerMatch: Record<number, number> = {};
  for (const t of teams) {
    const g = games[t.id] ?? 0;
    // 1.3 = league-average goals conceded, the prior when no games played yet.
    concededPerMatch[t.id] = g > 0 ? (conceded[t.id] ?? 0) / g : 1.3;
  }

  return {
    nextGw,
    lastGw,
    upcomingByTeam,
    concededPerMatch,
    gamesPlayed: games,
    seasonFinished: nextGw === null,
  };
}

/** Average fixture ease over the next `horizon` GWs, 0..1 — used by the FDR grid. */
export function fixtureEase(
  ctx: ProjectionContext,
  teamId: number,
  horizon: number,
): number | null {
  if (ctx.nextGw === null) return null;
  const window = (ctx.upcomingByTeam[teamId] ?? []).filter(
    (f) => f.event < (ctx.nextGw as number) + horizon,
  );
  if (window.length === 0) return null;
  return window.reduce((s, f) => s + (5 - f.difficulty) / 4, 0) / window.length;
}

// --- Points values by position ---

const GOAL_PTS: Record<Position, number> = { 1: 10, 2: 6, 3: 5, 4: 4 };
const CS_PTS: Record<Position, number> = { 1: 4, 2: 4, 3: 1, 4: 0 };
/** Defensive-contribution thresholds per match (2025/26 rule): DEF 10 CBIT, MID/FWD 12 CBIRT. */
const DC_THRESHOLD: Record<Position, number> = { 1: Infinity, 2: 10, 3: 12, 4: 12 };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const parseNum = (s: string) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

// --- Recency blending ---
// The season-rate model is stable but slow to react; these fold in the
// recency signals the FPL payload already carries (form, ep_next).

/** How far to move toward recent form — 0.5 regresses a ~4-game sample halfway. */
const FORM_WEIGHT = 0.5;
const FORM_FACTOR_MIN = 0.6;
const FORM_FACTOR_MAX = 1.6;
/** Weight given to FPL's own ep_next when anchoring the nearest gameweek. */
const EP_NEXT_WEIGHT = 0.35;

// --- Calibration ---
//
// The raw model is over-spread: it is too confident at both ends. Over 2025/26
// the top decile of 5-gameweek projections predicted 25.9 points and returned
// 19.2, while the bottom predicted 2.2 and returned 8.0 — textbook regression
// to the mean. A straight line can't reorder anything, so transfer *rankings*
// are untouched; what changes is every decision that reads an absolute gap. A
// raw +8 xPts edge is really worth +4.2, which is the difference between "worth
// a −4 hit" and a wasted hit.
//
// Fitted by scripts/backtest/calibrate.ts, walk-forward, on 2025/26 — re-derive
// each season. The coefficients come from the 5-gameweek horizon fit spread
// across its weeks, so that summing calibrated weeks reproduces that fit
// exactly. The horizon is the level transfer decisions read, and its slope is
// far steadier over a season (0.517–0.520) than the per-week one (0.632–0.681),
// which is what makes shipping a constant defensible at all.
const CALIBRATION_INTERCEPT = 1.115;
const CALIBRATION_SLOPE = 0.523;

/**
 * Map a raw gameweek projection onto the scale points are actually scored on.
 * A blank stays exactly 0: no fixture, no baseline to earn.
 *
 * `baselineWeight` gates the intercept, which was fitted only on players with
 * football behind them and doesn't describe anyone else. It stands for the
 * returns a fringe player scrapes together when he does turn out — low-minute
 * players in the fitted pool really did score, which is why the intercept is
 * flat across them rather than scaled by expected minutes. But a player with no
 * minutes at all is outside that pool entirely: hand him the baseline and the
 * deadwood you should be selling starts to look worth keeping.
 */
function calibrate(ep: number, hasFixture: boolean, baselineWeight: number): number {
  if (!hasFixture) return 0;
  return Math.max(
    0,
    CALIBRATION_INTERCEPT * clamp(baselineWeight, 0, 1) + CALIBRATION_SLOPE * ep,
  );
}

/**
 * How much of calibration's baseline a player has earned the right to.
 * Zero for anyone yet to kick a ball — the fit never saw such a player — and
 * tapered by availability, since a ruled-out player can't collect it either.
 */
function baselineWeight(p: Player, avail: number): number {
  return p.minutes > 0 ? avail : 0;
}

/**
 * Multiplier that nudges a season-rate projection toward recent form. `form`
 * (recent points per game) is compared to the player's own season PPG, so both
 * sides sit on the actual-points scale and the model-vs-actual scale mismatch
 * cancels. Regressed by FORM_WEIGHT because form is a small, noisy sample, and
 * bounded so one hot or cold streak can't dominate a horizon view.
 *
 * Only applied to fully available players: injuries, doubts, and suspensions
 * are already modelled by availabilityAt, and a flagged player's form is
 * depressed for the same reason, so letting form bite too would double-count.
 * A reliable season baseline is required (>=1 PPG over >=90 minutes); without
 * one the factor is neutral.
 */
export function formFactor(
  form: number,
  ppg: number,
  minutes: number,
  status: string,
): number {
  if (status !== "a" || ppg < 1 || minutes < 90) return 1;
  const ratio = form / ppg;
  return clamp(1 + (ratio - 1) * FORM_WEIGHT, FORM_FACTOR_MIN, FORM_FACTOR_MAX);
}

// --- Recent window (element-summary history) ---

/**
 * Shrinkage prior for recent rates, in minutes. A recent window is a small
 * sample, so it's blended with the season baseline rather than replacing it:
 * at RECENT_PRIOR_MINUTES of recent football the two carry equal weight, and
 * a thin window barely moves the season number.
 */
const RECENT_PRIOR_MINUTES = 270;

/** A player's recent matches reduced to totals. */
export interface RecentWindow {
  /** Team matches covered — the denominator for per-match figures */
  matches: number;
  minutes: number;
  starts: number;
  xg: number;
  xa: number;
  dc: number;
  saves: number;
  bonus: number;
}

/** Total a player's recent match rows into a window. */
export function summariseRecent(rows: HistoryRow[]): RecentWindow {
  const w: RecentWindow = {
    matches: rows.length,
    minutes: 0,
    starts: 0,
    xg: 0,
    xa: 0,
    dc: 0,
    saves: 0,
    bonus: 0,
  };
  for (const r of rows) {
    w.minutes += r.minutes;
    w.starts += r.starts;
    w.xg += parseNum(r.expected_goals);
    w.xa += parseNum(r.expected_assists);
    w.dc += r.defensive_contribution;
    w.saves += r.saves;
    w.bonus += r.bonus;
  }
  return w;
}

export function summariseHistories(histories: PlayerHistories): Map<number, RecentWindow> {
  const out = new Map<number, RecentWindow>();
  for (const [id, rows] of Object.entries(histories)) {
    out.set(Number(id), summariseRecent(rows));
  }
  return out;
}

/** Per-player rates precomputed once, independent of fixture. */
interface Rates {
  m: number; // expected share of 90 minutes when fit
  p60: number;
  pApp: number;
  xg90: number;
  xa90: number;
  saves90: number;
  dc90: number;
  bonusPerMatch: number;
  concededPerMatch: number;
  baseAvailability: number;
  /** True when a recent window informed these rates (see buildRates). */
  usedRecent: boolean;
}

/**
 * Rates for one player. Without a recent window these are season averages,
 * which understate anyone who arrived or became a starter mid-season. Given a
 * window, the recent numbers are blended in by sample size, which is what
 * corrects that: a player who has started the last five matches gets recent
 * minutes regardless of the months he spent on the bench.
 */
function buildRates(p: Player, ctx: ProjectionContext, recent?: RecentWindow): Rates {
  const teamGames = ctx.gamesPlayed[p.team] ?? 0;
  const seasonXMins = teamGames > 0 ? p.minutes / teamGames : 0;

  let xMins = seasonXMins;
  let xg90 = p.expected_goals_per_90 || 0;
  let xa90 = p.expected_assists_per_90 || 0;
  let saves90 = p.saves_per_90 || 0;
  let dc90 = p.defensive_contribution_per_90 || 0;
  let bonusPerMatch = p.minutes > 0 ? p.bonus / Math.max(1, p.minutes / 90) : 0;
  let usedRecent = false;

  // A window with no minutes says nothing about rates (and can't form a
  // denominator), so it's ignored — those players keep season rates and are
  // handled by the form factor and availability model instead.
  if (recent && recent.matches > 0 && recent.minutes > 0) {
    const w = recent.minutes / (recent.minutes + RECENT_PRIOR_MINUTES);
    const per90 = (total: number) => (total / recent.minutes) * 90;
    const blend = (recentVal: number, seasonVal: number) => w * recentVal + (1 - w) * seasonVal;

    xMins = blend(recent.minutes / recent.matches, seasonXMins);
    xg90 = blend(per90(recent.xg), xg90);
    xa90 = blend(per90(recent.xa), xa90);
    saves90 = blend(per90(recent.saves), saves90);
    dc90 = blend(per90(recent.dc), dc90);
    bonusPerMatch = blend(recent.bonus / recent.matches, bonusPerMatch);
    usedRecent = true;
  }

  return {
    m: clamp(xMins / 90, 0, 1),
    p60: clamp((xMins - 25) / 50, 0, 1),
    pApp: clamp(xMins / 45, 0, 1),
    xg90,
    xa90,
    saves90,
    dc90,
    bonusPerMatch,
    concededPerMatch: ctx.concededPerMatch[p.team] ?? 1.3,
    baseAvailability: baseAvailability(p),
    usedRecent,
  };
}

function baseAvailability(p: Player): number {
  if (p.status === "a") return 1;
  if (p.status === "d") return (p.chance_of_playing_next_round ?? 75) / 100;
  return 0.1;
}

/**
 * Availability `gwsAhead` gameweeks from now. Doubtful/injured/suspended
 * players are assumed back to full availability within ~4 GWs — a horizon
 * model must not write off a star with a knock. Players who left the league
 * or are unregistered ('u'/'n') never recover.
 */
export function availabilityAt(p: Player, base: number, gwsAhead: number): number {
  if (p.status === "u" || p.status === "n") return base;
  return base + (1 - base) * clamp(gwsAhead / 4, 0, 1);
}

/** Expected points for one match at the given difficulty (FDR 1–5, 3 = neutral). */
function epForMatch(p: Player, r: Rates, fdr: number): number {
  const pos = p.element_type;
  // Easier fixture → more attacking output, fewer goals conceded.
  const attackMult = 1 + (3 - fdr) * 0.12;
  const lambda = r.concededPerMatch * (1 + (fdr - 3) * 0.15);

  const appearance = r.pApp + r.p60;
  const attack = (r.xg90 * GOAL_PTS[pos] + r.xa90 * 3) * r.m * attackMult;
  const cleanSheet = CS_PTS[pos] * r.p60 * Math.exp(-lambda);
  // -1 per 2 conceded while on the pitch (GK/DEF); 0.5/goal approximates the floor.
  const concededPts = pos <= 2 ? -0.5 * lambda * r.m : 0;
  const saves = pos === 1 ? (r.saves90 * r.m) / 3 : 0;
  // P(hitting the DC threshold) from the per-match action rate: 0 at half the
  // threshold, ~0.65 at the threshold, capped at 0.9.
  const dcRate = r.dc90 * r.m;
  const dc = 2 * clamp((1.4 * dcRate) / DC_THRESHOLD[pos] - 0.75, 0, 0.9);

  return appearance + attack + cleanSheet + concededPts + saves + dc + r.bonusPerMatch * r.m;
}

export interface GwProjection {
  gw: number;
  ep: number;
  fixtures: UpcomingFixture[];
}

export interface PlayerProjection {
  player: Player;
  /** Expected minutes per match when fit */
  xMins: number;
  /** xPts for a single neutral-difficulty match at full availability. The raw
   * model's own number: pure season rates, before form adjustment and before
   * calibration — the transparent baseline. Everything else here (perGw,
   * horizonEp) is calibrated onto the actual-points scale, so this reads high
   * by comparison; prefer those for anything user-facing. */
  epPerMatch: number;
  /** Recent-form multiplier applied to perGw/horizonEp; 1 = on season baseline,
   * >1 in form, <1 out of form (see formFactor). Always 1 when usedRecent, as
   * real recent rates supersede the proxy. */
  form: number;
  /** True when true per-match recent data fed these rates, rather than season
   * averages plus the form proxy */
  usedRecent: boolean;
  /** xPts per gameweek from nextGw, availability-, fixture-, and form-adjusted */
  perGw: GwProjection[];
  /** Sum of perGw over the requested horizon */
  horizonEp: number;
}

/**
 * Project all `players` over the next `horizon` gameweeks. When the game is
 * between seasons (no fixtures), perGw is empty and horizonEp falls back to
 * epPerMatch × horizon so rankings still work.
 *
 * `recent` holds true per-match windows for whichever players we could afford
 * to fetch (one upstream request each, so usually a squad or a shortlist).
 * Players without one fall back to season rates nudged by the form proxy.
 */
export function projectPlayers(
  players: Player[],
  ctx: ProjectionContext,
  horizon: number,
  recent?: Map<number, RecentWindow>,
): Map<number, PlayerProjection> {
  const out = new Map<number, PlayerProjection>();
  for (const p of players) {
    const r = buildRates(p, ctx, recent?.get(p.id));
    const epPerMatch = epForMatch(p, r, 3);
    // The form factor is a proxy for recency built from season-wide numbers.
    // Where a real recent window already fed the rates it would double-count,
    // so it only applies to players without one. Between seasons it's off
    // entirely: FPL zeroes every player's `form` (no matches in the window),
    // which would otherwise cut the whole market to the floor.
    const ff =
      ctx.nextGw !== null && !r.usedRecent
        ? formFactor(parseNum(p.form), parseNum(p.points_per_game), p.minutes, p.status)
        : 1;
    const epNext = parseNum(p.ep_next);

    const perGw: GwProjection[] = [];
    if (ctx.nextGw !== null) {
      const end = Math.min(ctx.nextGw + horizon - 1, ctx.lastGw);
      const byGw = new Map<number, UpcomingFixture[]>();
      for (const f of ctx.upcomingByTeam[p.team] ?? []) {
        if (f.event > end) continue;
        if (!byGw.has(f.event)) byGw.set(f.event, []);
        byGw.get(f.event)!.push(f);
      }
      for (let gw = ctx.nextGw; gw <= end; gw++) {
        const fx = byGw.get(gw) ?? [];
        const avail = availabilityAt(p, r.baseAvailability, gw - ctx.nextGw);
        let ep = fx.reduce((s, f) => s + epForMatch(p, r, f.difficulty) * avail, 0) * ff;
        // Calibrate before blending: this puts our own number on the
        // actual-points scale, which is the scale ep_next already reports on.
        ep = calibrate(ep, fx.length > 0, baselineWeight(p, avail));
        // Anchor the nearest single-fixture gameweek to FPL's own ep_next: it
        // reflects late-breaking info our season rates can't, and steadies the
        // cold-start case (early season, new signings) where rates are thin.
        if (gw === ctx.nextGw && fx.length === 1 && epNext > 0) {
          ep = (1 - EP_NEXT_WEIGHT) * ep + EP_NEXT_WEIGHT * epNext;
        }
        perGw.push({ gw, ep: round1(ep), fixtures: fx });
      }
    }

    // Between seasons there are no fixtures to walk, so each of the `horizon`
    // weeks is treated as one notional match — calibrated like any other, to
    // keep horizonEp on a single scale year-round.
    const horizonEp =
      ctx.nextGw !== null
        ? perGw.reduce((s, g) => s + g.ep, 0)
        : calibrate(
            epPerMatch * r.baseAvailability * ff,
            true,
            baselineWeight(p, r.baseAvailability),
          ) * horizon;

    out.set(p.id, {
      player: p,
      xMins: Math.round(r.m * 90),
      epPerMatch: round1(epPerMatch),
      form: Math.round(ff * 100) / 100,
      usedRecent: r.usedRecent,
      perGw,
      horizonEp: round1(horizonEp),
    });
  }
  return out;
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/** What a transfer beyond your free ones actually costs. */
export const HIT_COST = 4;

/**
 * Projected gain a swap must clear before a −4 hit is worth recommending.
 * Deliberately far above the 4 points a hit costs.
 *
 * Breaking even on paper isn't enough, because the suggestion is the *best* of
 * hundreds of candidate swaps, and the maximum of many noisy estimates is
 * selected partly for its own optimism — the optimizer's curse. Calibration
 * fixes the average projection but can't fix a bias that only exists in the
 * argmax, so a threshold set at the nominal cost still fires on swaps whose
 * real edge is nowhere near it.
 *
 * Measured, not guessed (scripts/backtest/strategy-compare.ts, 2025/26): acting
 * on a threshold of 4 cost ~9 points per 5 gameweeks against simply never
 * taking a hit. The loss only vanishes around 10–12, by which point the advice
 * fires on a couple of percent of gameweeks and gains ~0. Hits, in short,
 * almost never pay — this threshold is set where it stops doing harm rather
 * than where it starts doing good. The exact figure is tuned on one season; the
 * direction (far stricter than the cost) is the robust part.
 */
export const WORTH_A_HIT_GAIN = 10;

export interface Upgrade {
  candidate: PlayerProjection;
  deltaEp: number;
  worthAHit: boolean;
}

/**
 * Best replacements for `outgoing` by xPts gained over the horizon. Enforces
 * same position, budget (price + bank), not already owned, max 3 per club,
 * and a minutes floor so bench fodder isn't suggested.
 */
export function findUpgrades(
  outgoing: PlayerProjection,
  market: Map<number, PlayerProjection>,
  squadIds: Set<number>,
  teamCounts: Record<number, number>,
  budgetTenths: number,
  limit = 3,
): Upgrade[] {
  const p = outgoing.player;
  const countExcludingOutgoing = (team: number) =>
    (teamCounts[team] ?? 0) - (team === p.team ? 1 : 0);

  return [...market.values()]
    .filter(
      (c) =>
        c.player.element_type === p.element_type &&
        !squadIds.has(c.player.id) &&
        c.player.now_cost <= budgetTenths &&
        c.horizonEp > outgoing.horizonEp &&
        c.xMins >= 45 &&
        c.player.status !== "u" &&
        c.player.status !== "n" &&
        countExcludingOutgoing(c.player.team) < 3,
    )
    .sort((a, b) => b.horizonEp - a.horizonEp)
    .slice(0, limit)
    .map((c) => {
      const deltaEp = round1(c.horizonEp - outgoing.horizonEp);
      return { candidate: c, deltaEp, worthAHit: deltaEp > WORTH_A_HIT_GAIN };
    });
}

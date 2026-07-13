// Transparent scoring model for transfer and captaincy decisions.
//
// Each player gets a 0–100 score built from normalized components. Components
// that are degenerate right now (e.g. form is 0.0 for everyone in pre-season,
// or no upcoming fixtures exist yet) drop out and the remaining weights are
// renormalized, so the model keeps working across the season and the summer.

import type { Event, Fixture, Player } from "./types";

export interface UpcomingFixture {
  event: number;
  opponent: number;
  isHome: boolean;
  difficulty: number; // FPL FDR, 1 (easiest) to 5 (hardest)
}

export interface FixtureContext {
  nextGw: number | null;
  upcomingByTeam: Record<number, UpcomingFixture[]>;
  seasonFinished: boolean;
}

export function buildFixtureContext(
  fixtures: Fixture[],
  events: Event[],
): FixtureContext {
  const next = events.find((e) => e.is_next) ?? events.find((e) => !e.finished);
  const nextGw = next?.id ?? null;

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

  return {
    nextGw,
    upcomingByTeam,
    seasonFinished: nextGw === null,
  };
}

/** Average fixture ease over the next `horizon` gameweeks, 0..1 (1 = easiest). */
export function fixtureEase(
  ctx: FixtureContext,
  teamId: number,
  horizon: number,
): number | null {
  if (ctx.nextGw === null) return null;
  const window = (ctx.upcomingByTeam[teamId] ?? []).filter(
    (f) => f.event < (ctx.nextGw as number) + horizon,
  );
  if (window.length === 0) return null;
  const ease = window.reduce((sum, f) => sum + (5 - f.difficulty) / 4, 0);
  return ease / window.length;
}

export interface ScoreParts {
  ppg: number | null;
  form: number | null;
  ep: number | null;
  fixtures: number | null;
  value: number | null;
}

export interface Scored {
  player: Player;
  /** 0–100, availability already applied */
  score: number;
  parts: ScoreParts;
  availability: number;
}

export type Weights = Record<keyof ScoreParts, number>;

export const TRANSFER_WEIGHTS: Weights = {
  ppg: 0.3,
  form: 0.25,
  ep: 0.2,
  fixtures: 0.15,
  value: 0.1,
};

export const CAPTAINCY_WEIGHTS: Weights = {
  ep: 0.4,
  form: 0.25,
  ppg: 0.2,
  fixtures: 0.15,
  value: 0,
};

export function availabilityFactor(p: Player): number {
  if (p.status === "a") return 1;
  if (p.status === "d") return (p.chance_of_playing_next_round ?? 75) / 100;
  return 0.15;
}

function rawParts(p: Player, ctx: FixtureContext, horizon: number) {
  return {
    ppg: parseFloat(p.points_per_game) || 0,
    form: parseFloat(p.form) || 0,
    ep: parseFloat(p.ep_next) || 0,
    fixtures: fixtureEase(ctx, p.team, horizon),
    value: p.now_cost > 0 ? p.total_points / (p.now_cost / 10) : 0,
  };
}

/**
 * Score `players`, normalizing each component within `groupOf` buckets
 * (position for the transfer market, a single bucket for a squad ranking).
 */
export function scorePlayers(
  players: Player[],
  ctx: FixtureContext,
  weights: Weights,
  horizon: number,
  groupOf: (p: Player) => number = (p) => p.element_type,
): Map<number, Scored> {
  const raws = new Map(players.map((p) => [p.id, rawParts(p, ctx, horizon)]));

  // Max of each component per group, for 0..1 normalization.
  const keys: (keyof ScoreParts)[] = ["ppg", "form", "ep", "fixtures", "value"];
  const maxima = new Map<number, Record<string, number>>();
  for (const p of players) {
    const g = groupOf(p);
    const m = maxima.get(g) ?? {};
    const r = raws.get(p.id)!;
    for (const k of keys) {
      const v = r[k];
      if (v !== null && v > (m[k] ?? 0)) m[k] = v;
    }
    maxima.set(g, m);
  }

  const out = new Map<number, Scored>();
  for (const p of players) {
    const r = raws.get(p.id)!;
    const m = maxima.get(groupOf(p))!;
    const parts: ScoreParts = { ppg: null, form: null, ep: null, fixtures: null, value: null };
    let weighted = 0;
    let weightSum = 0;
    for (const k of keys) {
      const v = r[k];
      const max = m[k] ?? 0;
      // Drop components that carry no signal (null, or flat zero for the group).
      if (v === null || max <= 0 || weights[k] === 0) continue;
      parts[k] = v / max;
      weighted += weights[k] * (v / max);
      weightSum += weights[k];
    }
    const base = weightSum > 0 ? (weighted / weightSum) * 100 : 0;
    const availability = availabilityFactor(p);
    out.set(p.id, {
      player: p,
      score: Math.round(base * availability * 10) / 10,
      parts,
      availability,
    });
  }
  return out;
}

/**
 * Better-scoring, affordable, legal replacements for `outgoing`.
 * `budgetTenths` = outgoing price + bank. Enforces same position, not already
 * owned, and the max-3-per-club rule.
 */
export function findUpgrades(
  outgoing: Scored,
  market: Map<number, Scored>,
  squadIds: Set<number>,
  teamCounts: Record<number, number>,
  budgetTenths: number,
  limit = 3,
): Scored[] {
  const p = outgoing.player;
  const countExcludingOutgoing = (team: number) =>
    (teamCounts[team] ?? 0) - (team === p.team ? 1 : 0);

  return [...market.values()]
    .filter(
      (c) =>
        c.player.element_type === p.element_type &&
        !squadIds.has(c.player.id) &&
        c.player.now_cost <= budgetTenths &&
        c.score > outgoing.score &&
        c.availability >= 0.75 &&
        countExcludingOutgoing(c.player.team) < 3,
    )
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

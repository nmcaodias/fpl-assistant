// Initial-squad optimizer: pick the best legal 15 within a budget.
//
// The formulation follows the integer-programming approach in the FPL
// literature (Ghasemi et al., arXiv:2505.02170): maximize expected points
// subject to a budget, the 2/5/5/3 squad quotas, and at most three players per
// club — with two additions the papers argue for. The captain is counted twice
// in the objective, because a squad optimized on raw value-per-pound never
// buys the premium whose doubled score you actually captain every week. And
// bench players are discounted to a fraction of a starter, which is what makes
// the classic cheap-bench/strong-XI budget split emerge on its own rather than
// being hard-coded.
//
// Exact ILP needs a solver; this uses greedy seeds + steepest-ascent swap
// search instead, which handles every constraint uniformly, runs in
// milliseconds, and in testing matches or beats seeded greedy solutions from
// every start. Position quotas are fixed, so single same-position swaps can
// reach any legal squad — the search space is connected.

import { bestXi } from "./planner";
import type { PlayerProjection } from "./projection";
import type { Position } from "./types";

/** Squad quotas: 2 GK, 5 DEF, 5 MID, 3 FWD. */
export const SQUAD_QUOTAS: Record<Position, number> = { 1: 2, 2: 5, 3: 5, 4: 3 };
export const SQUAD_SIZE = 15;
const MAX_PER_CLUB = 3;

/** How much a bench slot is worth relative to a starter. Roughly the odds a
 * bench player ends up scoring for you via an auto-sub. */
const BENCH_WEIGHT = 0.15;

export interface BuiltSquad {
  /** Formation-legal best XI by horizon xPts. */
  starters: PlayerProjection[];
  /** The other four, best first. */
  bench: PlayerProjection[];
  /** Highest-projected starter — the doubled score the objective assumes. */
  captain: PlayerProjection;
  costTenths: number;
  bankTenths: number;
  /** Σ starters + captain again + BENCH_WEIGHT × Σ bench, in horizon xPts. */
  objective: number;
  /** Σ starters' horizon xPts (captain not doubled). */
  xiEp: number;
}

interface Pool {
  byPos: Map<Position, PlayerProjection[]>;
  all: PlayerProjection[];
}

const ep = (p: PlayerProjection) => p.horizonEp;
const cost = (p: PlayerProjection) => p.player.now_cost;

function buildPool(market: Map<number, PlayerProjection>): Pool {
  const all = [...market.values()].filter(
    (p) => p.player.status !== "u" && p.player.status !== "n",
  );
  const byPos = new Map<Position, PlayerProjection[]>([[1, []], [2, []], [3, []], [4, []]]);
  for (const p of all) byPos.get(p.player.element_type)?.push(p);
  // Cheapest-first tail lets the seeds compute feasibility reserves quickly.
  for (const ps of byPos.values()) ps.sort((a, b) => ep(b) - ep(a));
  return { byPos, all };
}

/**
 * Exact budget reserve: the cost of filling every still-open slot with the
 * cheapest available players, position by position. Must exclude players
 * already picked (once the cheapest goalkeeper is in the squad the second one
 * costs more) and must price n open slots with the n cheapest players, not the
 * single cheapest n times — either shortcut lets the budget run exactly short.
 * `subtract` names a position whose first cheapest slot the caller is about to
 * fill itself.
 */
function reserveFor(
  pool: Pool,
  taken: Set<number>,
  need: Record<Position, number>,
  subtract: Position,
): number {
  let total = 0;
  for (const pos of [1, 2, 3, 4] as Position[]) {
    const open = need[pos] - (pos === subtract ? 1 : 0);
    if (open <= 0) continue;
    const costs = (pool.byPos.get(pos) ?? [])
      .filter((p) => !taken.has(p.player.id))
      .map(cost)
      .sort((a, b) => a - b);
    if (costs.length < open) return Infinity;
    for (let i = 0; i < open; i++) total += costs[i];
  }
  return total;
}

function objectiveOf(squad: PlayerProjection[]): {
  objective: number;
  starters: PlayerProjection[];
  bench: PlayerProjection[];
  captain: PlayerProjection;
  xiEp: number;
} {
  const starters = bestXi(squad, ep);
  const inXi = new Set(starters.map((p) => p.player.id));
  const bench = squad.filter((p) => !inXi.has(p.player.id)).sort((a, b) => ep(b) - ep(a));
  const xiEp = starters.reduce((s, p) => s + ep(p), 0);
  const captain = starters.reduce((best, p) => (ep(p) > ep(best) ? p : best), starters[0]);
  const benchEp = bench.reduce((s, p) => s + ep(p), 0);
  return {
    objective: xiEp + ep(captain) + BENCH_WEIGHT * benchEp,
    starters,
    bench,
    captain,
    xiEp,
  };
}

/**
 * Greedy seed: fill the 15 slots one at a time, at each step taking the
 * feasible player with the best score under `keyOf`, while reserving enough
 * budget to fill every remaining slot with the cheapest legal player.
 */
function greedySeed(
  pool: Pool,
  budgetTenths: number,
  keyOf: (p: PlayerProjection, slotIndex: number) => number,
): PlayerProjection[] | null {
  const squad: PlayerProjection[] = [];
  const taken = new Set<number>();
  const clubCount: Record<number, number> = {};
  const need: Record<Position, number> = { ...SQUAD_QUOTAS };
  let spent = 0;

  for (let slot = 0; slot < SQUAD_SIZE; slot++) {
    let best: PlayerProjection | null = null;
    let bestKey = -Infinity;
    for (const pos of [1, 2, 3, 4] as Position[]) {
      if (need[pos] === 0) continue;
      // Budget that must stay reserved to fill the other open slots.
      const reserve = reserveFor(pool, taken, need, pos);
      for (const p of pool.byPos.get(pos) ?? []) {
        if (taken.has(p.player.id)) continue;
        if ((clubCount[p.player.team] ?? 0) >= MAX_PER_CLUB) continue;
        if (spent + cost(p) + reserve > budgetTenths) continue;
        const k = keyOf(p, slot);
        if (k > bestKey) {
          bestKey = k;
          best = p;
        }
      }
    }
    if (!best) return null;
    squad.push(best);
    taken.add(best.player.id);
    spent += cost(best);
    clubCount[best.player.team] = (clubCount[best.player.team] ?? 0) + 1;
    need[best.player.element_type]--;
  }
  return squad;
}

/** Steepest-ascent: apply the best feasible same-position swap until none improves. */
function localSearch(
  squad: PlayerProjection[],
  pool: Pool,
  budgetTenths: number,
): PlayerProjection[] {
  let current = squad;
  let currentObj = objectiveOf(current).objective;

  for (;;) {
    const spent = current.reduce((s, p) => s + cost(p), 0);
    const clubCount: Record<number, number> = {};
    for (const p of current) clubCount[p.player.team] = (clubCount[p.player.team] ?? 0) + 1;
    const ids = new Set(current.map((p) => p.player.id));

    let bestSwap: { out: PlayerProjection; in: PlayerProjection; obj: number } | null = null;
    for (const out of current) {
      for (const cand of pool.byPos.get(out.player.element_type) ?? []) {
        if (ids.has(cand.player.id)) continue;
        if (spent - cost(out) + cost(cand) > budgetTenths) continue;
        const clubAfter =
          (clubCount[cand.player.team] ?? 0) - (cand.player.team === out.player.team ? 1 : 0);
        if (clubAfter >= MAX_PER_CLUB) continue;
        const next = current.map((p) => (p.player.id === out.player.id ? cand : p));
        const obj = objectiveOf(next).objective;
        if (obj > currentObj + 1e-9 && (!bestSwap || obj > bestSwap.obj)) {
          bestSwap = { out, in: cand, obj };
        }
      }
    }
    if (!bestSwap) return current;
    current = current.map((p) => (p.player.id === bestSwap!.out.player.id ? bestSwap!.in : p));
    currentObj = bestSwap.obj;
  }
}

/**
 * Build the best squad the search can find for the budget (tenths of £m).
 * Deterministic. Returns null when the pool can't fill a legal squad at all
 * (e.g. a budget below the sum of cheapest legal players).
 */
export function buildSquad(
  market: Map<number, PlayerProjection>,
  budgetTenths: number,
): BuiltSquad | null {
  const pool = buildPool(market);
  if (([1, 2, 3, 4] as Position[]).some((pos) => (pool.byPos.get(pos)?.length ?? 0) < SQUAD_QUOTAS[pos]))
    return null;

  // Three seeds spanning the strategy space the papers describe: pure points
  // (premium-heavy), value per pound (the ROI trap when alone), and a hybrid
  // that buys premiums early then value. Local search then repairs each.
  const seeds = [
    greedySeed(pool, budgetTenths, (p) => ep(p)),
    greedySeed(pool, budgetTenths, (p) => ep(p) / Math.max(cost(p), 1)),
    greedySeed(pool, budgetTenths, (p, slot) =>
      slot < 3 ? ep(p) : ep(p) / Math.max(cost(p), 1),
    ),
  ].filter((s): s is PlayerProjection[] => s !== null);
  if (seeds.length === 0) return null;

  let best: PlayerProjection[] | null = null;
  let bestObj = -Infinity;
  for (const seed of seeds) {
    const improved = localSearch(seed, pool, budgetTenths);
    const obj = objectiveOf(improved).objective;
    if (obj > bestObj) {
      bestObj = obj;
      best = improved;
    }
  }
  if (!best) return null;

  const detail = objectiveOf(best);
  const costTenths = best.reduce((s, p) => s + cost(p), 0);
  return {
    starters: detail.starters,
    bench: detail.bench,
    captain: detail.captain,
    costTenths,
    bankTenths: budgetTenths - costTenths,
    objective: round1(detail.objective),
    xiEp: round1(detail.xiEp),
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

// Multi-week transfer planner.
//
// The transfers page answers "what is the best single swap right now?"; this
// answers "what *sequence* of moves over the next few gameweeks earns the most
// xPts?" — including doing nothing this week to bank a free transfer, waiting
// for a fixture swing before swapping, chaining budget (sell early to afford
// someone later), and taking a −4 hit only when it pays for itself.
//
// It's a beam search over weeks. Each state carries the squad, the bank, and
// the banked free transfers; each week a state may make 0, 1, or 2
// same-position swaps. States are scored by the best legal starting XI's
// projected points that week, so upgrading a bench body doesn't count like
// upgrading a starter. Beam search isn't guaranteed optimal, but with the
// candidate pruning below it reliably finds plans a human would call right,
// in milliseconds.

import type { PlayerProjection, ProjectionContext } from "./projection";
import { HIT_COST } from "./projection";
import type { Position } from "./types";

/** FPL lets a manager bank at most this many free transfers. */
export const MAX_FREE_TRANSFERS = 5;

/** Search knobs: candidates considered per slot each week, and beam width.
 * Larger finds marginally better plans, slower; these are comfortable. */
const CANDIDATES_PER_SLOT = 4;
const BEAM_WIDTH = 24;
/** Most transfers the planner will schedule in a single gameweek. */
const MAX_MOVES_PER_WEEK = 2;
/** Ignore swaps that gain less than this over the remaining horizon — they're
 * inside the model's noise and would churn the squad for nothing. */
const MIN_MOVE_GAIN = 1.5;

export interface PlannedMove {
  out: PlayerProjection;
  in: PlayerProjection;
  /** xPts gained over the remaining weeks of the plan by this swap alone. */
  gain: number;
}

export interface PlannedWeek {
  gw: number;
  moves: PlannedMove[];
  /** Points deducted this week for transfers beyond the available free ones. */
  hitCost: number;
  /** Free transfers available at this week's deadline, before the moves. */
  freeTransfers: number;
  /** Bank after this week's moves, in tenths of £m. */
  bankAfter: number;
  /** Best-XI projected points for this week's (post-move) squad. */
  xiEp: number;
}

export interface Plan {
  weeks: PlannedWeek[];
  /** Sum of weekly best-XI xPts minus hit costs. */
  totalEp: number;
  /** The same squad left untouched, scored the same way. */
  baselineEp: number;
  /** totalEp − baselineEp: what following the plan is worth. */
  gain: number;
  totalHitCost: number;
}

export interface PlannerOptions {
  /** Free transfers available at the first deadline (0–5). */
  freeTransfers: number;
  /** Bank in tenths of £m. */
  bankTenths: number;
  /** Weeks to plan; capped by the projections' horizon. */
  weeks: number;
  /** When false the planner never schedules more transfers than are free. */
  allowHits?: boolean;
}

// --- Best legal starting XI ---

/** Valid FPL formations: 1 GK + DEF 3–5, MID 2–5, FWD 1–3 summing to 10. */
const FORMATIONS: [number, number, number][] = [];
for (let d = 3; d <= 5; d++)
  for (let m = 2; m <= 5; m++)
    for (let f = 1; f <= 3; f++) if (d + m + f === 10) FORMATIONS.push([d, m, f]);

/**
 * Highest projected-points legal XI from a 15-man squad for one week.
 * `epOf` supplies each player's xPts for that week.
 */
export function bestXi(
  squad: PlayerProjection[],
  epOf: (p: PlayerProjection) => number,
): PlayerProjection[] {
  const byPos = new Map<Position, PlayerProjection[]>([[1, []], [2, []], [3, []], [4, []]]);
  for (const p of squad) byPos.get(p.player.element_type)?.push(p);
  for (const ps of byPos.values()) ps.sort((a, b) => epOf(b) - epOf(a));

  const take = (pos: Position, n: number) => byPos.get(pos)!.slice(0, n);
  const sum = (ps: PlayerProjection[]) => ps.reduce((s, p) => s + epOf(p), 0);

  const gk = take(1, 1);
  let best: PlayerProjection[] = [];
  let bestEp = -Infinity;
  for (const [d, m, f] of FORMATIONS) {
    if (byPos.get(2)!.length < d || byPos.get(3)!.length < m || byPos.get(4)!.length < f)
      continue;
    const xi = [...gk, ...take(2, d), ...take(3, m), ...take(4, f)];
    const ep = sum(xi);
    if (ep > bestEp) {
      bestEp = ep;
      best = xi;
    }
  }
  return best;
}

/** Projected points of the best legal XI (see bestXi). */
export function bestXiEp(
  squad: PlayerProjection[],
  epOf: (p: PlayerProjection) => number,
): number {
  return bestXi(squad, epOf).reduce((s, p) => s + epOf(p), 0);
}

// --- Beam search ---

interface SearchState {
  squadIds: Set<number>;
  bank: number;
  freeTransfers: number;
  /** Best-XI points accumulated so far, hits already subtracted. */
  score: number;
  weeks: PlannedWeek[];
}

/** Suffix sums of per-GW ep: remaining[i] = points from week i to the end. */
function remainingEp(p: PlayerProjection, weeks: number): number[] {
  const rem = new Array<number>(weeks + 1).fill(0);
  for (let i = weeks - 1; i >= 0; i--) rem[i] = rem[i + 1] + (p.perGw[i]?.ep ?? 0);
  return rem;
}

const stateKey = (s: SearchState) =>
  [...s.squadIds].sort((a, b) => a - b).join(",") + `|${s.bank}|${s.freeTransfers}`;

/**
 * Plan transfers for `squadIds` over the coming weeks. `market` must hold
 * projections for the whole player pool (squad included), built with a horizon
 * of at least `options.weeks`. Returns null between seasons — there is nothing
 * to sequence against without fixtures.
 */
export function planTransfers(
  squadIds: number[],
  market: Map<number, PlayerProjection>,
  ctx: ProjectionContext,
  options: PlannerOptions,
): Plan | null {
  if (ctx.nextGw === null) return null;

  const squad = squadIds
    .map((id) => market.get(id))
    .filter((p): p is PlayerProjection => p !== undefined);
  if (squad.length === 0) return null;

  const weeks = Math.max(
    1,
    Math.min(options.weeks, ...squad.map((p) => p.perGw.length)),
  );
  const allowHits = options.allowHits ?? true;

  const rem = new Map<number, number[]>();
  for (const p of market.values()) rem.set(p.player.id, remainingEp(p, weeks));

  // Market sorted per position by remaining ep from each week — candidate
  // lookups walk these from the top instead of rescanning everything.
  const byPosWeek = new Map<Position, PlayerProjection[][]>();
  for (const pos of [1, 2, 3, 4] as Position[]) {
    const pool = [...market.values()].filter(
      (p) =>
        p.player.element_type === pos &&
        p.xMins >= 45 &&
        p.player.status !== "u" &&
        p.player.status !== "n",
    );
    byPosWeek.set(
      pos,
      Array.from({ length: weeks }, (_, w) =>
        [...pool].sort((a, b) => rem.get(b.player.id)![w] - rem.get(a.player.id)![w]),
      ),
    );
  }

  const teamCount = (ids: Set<number>, team: number, excluding?: number) => {
    let n = 0;
    for (const id of ids) {
      if (id === excluding) continue;
      const p = market.get(id);
      if (p && p.player.team === team) n++;
    }
    return n;
  };

  /** Top single swaps for one state at week `w`, best remaining-gain first. */
  function candidateMoves(state: SearchState, w: number): PlannedMove[] {
    const out: PlannedMove[] = [];
    for (const outId of state.squadIds) {
      const o = market.get(outId);
      if (!o) continue;
      const budget = o.player.now_cost + state.bank;
      const oRem = rem.get(outId)![w];
      const ranked = byPosWeek.get(o.player.element_type)![w];
      let taken = 0;
      for (const c of ranked) {
        if (taken >= CANDIDATES_PER_SLOT) break;
        const gain = rem.get(c.player.id)![w] - oRem;
        if (gain < MIN_MOVE_GAIN) break; // ranked list ⇒ nothing better follows
        if (state.squadIds.has(c.player.id)) continue;
        if (c.player.now_cost > budget) continue;
        if (teamCount(state.squadIds, c.player.team, outId) >= 3) continue;
        out.push({ out: o, in: c, gain: round1(gain) });
        taken++;
      }
    }
    return out.sort((a, b) => b.gain - a.gain);
  }

  function applyWeek(
    state: SearchState,
    gw: number,
    w: number,
    moves: PlannedMove[],
  ): SearchState | null {
    const squadIdsNext = new Set(state.squadIds);
    let bank = state.bank;
    for (const m of moves) {
      // A pair generated from the same base state can collide (same buy, or
      // second swap invalid after the first) — re-validate against the squad
      // as it stands mid-week.
      if (!squadIdsNext.has(m.out.player.id) || squadIdsNext.has(m.in.player.id)) return null;
      if (m.in.player.now_cost > m.out.player.now_cost + bank) return null;
      if (teamCount(squadIdsNext, m.in.player.team, m.out.player.id) >= 3) return null;
      squadIdsNext.delete(m.out.player.id);
      squadIdsNext.add(m.in.player.id);
      bank += m.out.player.now_cost - m.in.player.now_cost;
    }

    const paid = Math.max(0, moves.length - state.freeTransfers);
    if (paid > 0 && !allowHits) return null;
    const hitCost = paid * HIT_COST;

    const squadNow = [...squadIdsNext]
      .map((id) => market.get(id))
      .filter((p): p is PlayerProjection => p !== undefined);
    const xiEp = round1(bestXiEp(squadNow, (p) => p.perGw[w]?.ep ?? 0));

    return {
      squadIds: squadIdsNext,
      bank,
      freeTransfers: Math.min(
        Math.max(state.freeTransfers - moves.length, 0) + 1,
        MAX_FREE_TRANSFERS,
      ),
      score: state.score + xiEp - hitCost,
      weeks: [
        ...state.weeks,
        {
          gw,
          moves,
          hitCost,
          freeTransfers: state.freeTransfers,
          bankAfter: bank,
          xiEp,
        },
      ],
    };
  }

  let beam: SearchState[] = [
    {
      squadIds: new Set(squadIds),
      bank: options.bankTenths,
      freeTransfers: Math.min(Math.max(options.freeTransfers, 0), MAX_FREE_TRANSFERS),
      score: 0,
      weeks: [],
    },
  ];

  for (let w = 0; w < weeks; w++) {
    const gw = ctx.nextGw + w;
    const next = new Map<string, SearchState>();
    const consider = (s: SearchState | null) => {
      if (!s) return;
      const key = stateKey(s);
      const seen = next.get(key);
      if (!seen || s.score > seen.score) next.set(key, s);
    };

    for (const state of beam) {
      consider(applyWeek(state, gw, w, []));
      const candidates = candidateMoves(state, w);
      for (const m of candidates) consider(applyWeek(state, gw, w, [m]));
      if (MAX_MOVES_PER_WEEK >= 2) {
        // Pairs from the strongest few candidates — enough to find the classic
        // "double move before a swing", without a combinatorial blowup.
        const top = candidates.slice(0, 6);
        for (let i = 0; i < top.length; i++)
          for (let j = i + 1; j < top.length; j++)
            if (top[i].out.player.id !== top[j].out.player.id)
              consider(applyWeek(state, gw, w, [top[i], top[j]]));
      }
    }

    beam = [...next.values()].sort((a, b) => b.score - a.score).slice(0, BEAM_WIDTH);
  }

  const best = beam[0];

  // The do-nothing baseline, scored identically.
  let baselineEp = 0;
  for (let w = 0; w < weeks; w++) {
    baselineEp += round1(bestXiEp(squad, (p) => p.perGw[w]?.ep ?? 0));
  }
  baselineEp = round1(baselineEp);

  const totalHitCost = best.weeks.reduce((s, wk) => s + wk.hitCost, 0);
  const totalEp = round1(best.score);

  return {
    weeks: best.weeks,
    totalEp,
    baselineEp,
    gain: round1(totalEp - baselineEp),
    totalHitCost,
  };
}

function round1(n: number) {
  return Math.round(n * 10) / 10;
}

/**
 * Does the multi-week planner actually beat the single-swap advice?
 *
 * Simulates three strategies forward through last season and scores them on
 * points that were really scored, not on what the model predicted:
 *
 *   pat     — never transfer (the floor)
 *   greedy  — the transfers page's advice: each week take the single best swap
 *             by 5-GW xPts gain; use the free transfer, take a −4 only when
 *             the gain clears the hit (what "worth a hit" means on that page)
 *   planner — run the multi-week planner every week and play only its first
 *             week's moves, then re-plan (how a manager would really use it)
 *
 * Every decision — transfers and XI selection — is made from projections
 * rebuilt with no lookahead; only the scoring reads actuals. Simplifications,
 * applied identically to all three so the comparison stays fair: no auto-subs
 * (the chosen XI is scored as picked) and no captaincy.
 *
 *   npx tsx scripts/backtest/strategy-compare.ts
 */
import { bestXi, planTransfers, MAX_FREE_TRANSFERS } from "../../src/lib/planner";
import { HIT_COST, projectPlayers } from "../../src/lib/projection";
import type { PlayerProjection } from "../../src/lib/projection";
import type { Position } from "../../src/lib/types";
import { mean } from "./metrics";
import { actualForGw, loadData, reconstructGw, type BacktestData } from "./reconstruct";

const WEEKS = 5;
const FIRST_ORIGIN = 8;
const LAST_ORIGIN = 30;
const START_BANK = 5;
const START_FT = 1;
/** Squad quality profiles: how many of the best players at each position to
 * skip when building the starting squad. 0 = a strong squad with little room
 * to improve; 6 = a mediocre one with plenty. */
const SKIP_PROFILES = [0, 3, 6];
/** Mirrors the planner's own noise floor so greedy isn't handicapped. */
const MIN_MOVE_GAIN = 1.5;

type Market = Map<number, PlayerProjection>;

interface SquadState {
  ids: Set<number>;
  bank: number;
  ft: number;
}

const QUOTAS: [Position, number][] = [[1, 2], [2, 5], [3, 5], [4, 3]];

/** A plausible squad from the players known to be good at `gw`, skipping the
 * top `skip` per position so there's realistic room to improve. */
function buildSquad(market: Market, skip: number): number[] {
  const byPoints = [...market.values()].sort(
    (a, b) => b.player.total_points - a.player.total_points,
  );
  const ids: number[] = [];
  const clubs: Record<number, number> = {};
  for (const [pos, quota] of QUOTAS) {
    let skipped = 0;
    let taken = 0;
    for (const p of byPoints) {
      if (p.player.element_type !== pos) continue;
      if (skipped < skip) {
        skipped++;
        continue;
      }
      if ((clubs[p.player.team] ?? 0) >= 3) continue;
      ids.push(p.player.id);
      clubs[p.player.team] = (clubs[p.player.team] ?? 0) + 1;
      if (++taken >= quota) break;
    }
  }
  return ids;
}

const teamCount = (market: Market, ids: Set<number>, team: number, excluding: number) => {
  let n = 0;
  for (const id of ids) {
    if (id === excluding) continue;
    if (market.get(id)?.player.team === team) n++;
  }
  return n;
};

/** The transfers page's recommendation: the single best legal swap by 5-GW gain. */
function bestSingleSwap(state: SquadState, market: Market) {
  let best: { out: PlayerProjection; in: PlayerProjection; gain: number } | null = null;
  for (const outId of state.ids) {
    const o = market.get(outId);
    if (!o) continue;
    const budget = o.player.now_cost + state.bank;
    for (const c of market.values()) {
      if (c.player.element_type !== o.player.element_type) continue;
      if (state.ids.has(c.player.id)) continue;
      if (c.player.now_cost > budget) continue;
      if (c.xMins < 45) continue;
      if (c.player.status === "u" || c.player.status === "n") continue;
      if (teamCount(market, state.ids, c.player.team, outId) >= 3) continue;
      const gain = c.horizonEp - o.horizonEp;
      if (!best || gain > best.gain) best = { out: o, in: c, gain };
    }
  }
  return best;
}

function applyMove(
  state: SquadState,
  move: { out: PlayerProjection; in: PlayerProjection },
): void {
  state.ids.delete(move.out.player.id);
  state.ids.add(move.in.player.id);
  state.bank += move.out.player.now_cost - move.in.player.now_cost;
}

/** Actual points the projection-chosen XI really scored in `gw`. */
function scoreWeek(data: BacktestData, state: SquadState, market: Market, gw: number): number {
  const squad = [...state.ids]
    .map((id) => market.get(id))
    .filter((p): p is PlayerProjection => p !== undefined);
  const xi = bestXi(squad, (p) => p.perGw[0]?.ep ?? 0);
  return xi.reduce((s, p) => s + actualForGw(data, p.player.id, gw).points, 0);
}

type Strategy = "pat" | "greedy" | "planner" | "plannerNoHits";

interface RunResult {
  actual: number;
  transfers: number;
  hits: number;
}

function runStrategy(
  data: BacktestData,
  strategy: Strategy,
  startIds: number[],
  origin: number,
  marketByGw: Map<number, Market>,
): RunResult {
  const state: SquadState = { ids: new Set(startIds), bank: START_BANK, ft: START_FT };
  let actual = 0;
  let transfers = 0;
  let hits = 0;

  for (let w = 0; w < WEEKS; w++) {
    const gw = origin + w;
    const market = marketByGw.get(gw);
    if (!market) break;

    let movesThisWeek = 0;

    if (strategy === "greedy") {
      const swap = bestSingleSwap(state, market);
      // Play the free transfer on any worthwhile gain; pay −4 only when the
      // gain beats the hit, exactly as the transfers page advises.
      if (swap && (state.ft > 0 ? swap.gain >= MIN_MOVE_GAIN : swap.gain > HIT_COST)) {
        applyMove(state, swap);
        movesThisWeek = 1;
      }
    } else if (strategy === "planner" || strategy === "plannerNoHits") {
      const plan = planTransfers([...state.ids], market, { ...ctxStub(gw) }, {
        freeTransfers: state.ft,
        bankTenths: state.bank,
        // Plan the full horizon every week, as a real manager would — the same
        // forward view greedy's horizonEp already has.
        weeks: WEEKS,
        allowHits: strategy === "planner",
      });
      // Only this week's moves are committed; next week we re-plan.
      for (const m of plan?.weeks[0]?.moves ?? []) {
        applyMove(state, m);
        movesThisWeek++;
      }
    }

    const paid = Math.max(0, movesThisWeek - state.ft);
    hits += paid * HIT_COST;
    transfers += movesThisWeek;
    state.ft = Math.min(Math.max(state.ft - movesThisWeek, 0) + 1, MAX_FREE_TRANSFERS);

    actual += scoreWeek(data, state, market, gw) - paid * HIT_COST;
  }

  return { actual, transfers, hits };
}

/** The planner only reads nextGw off the context; the rest of the projection
 * work is already baked into the per-GW market. */
function ctxStub(gw: number) {
  return {
    nextGw: gw,
    lastGw: 38,
    upcomingByTeam: {},
    concededPerMatch: {},
    gamesPlayed: {},
    seasonFinished: false,
  };
}

function main() {
  const data = loadData();
  console.log("Projecting each gameweek (no lookahead)…");
  const marketByGw = new Map<number, Market>();
  for (let gw = FIRST_ORIGIN; gw <= LAST_ORIGIN + WEEKS; gw++) {
    const { players, ctx, recent } = reconstructGw(data, gw);
    marketByGw.set(gw, projectPlayers(players, ctx, WEEKS, recent));
  }

  const rows: { profile: number; origin: number; res: Record<Strategy, RunResult> }[] = [];
  for (const skip of SKIP_PROFILES) {
    for (let origin = FIRST_ORIGIN; origin <= LAST_ORIGIN; origin++) {
      const startIds = buildSquad(marketByGw.get(origin)!, skip);
      const res = {
        pat: runStrategy(data, "pat", startIds, origin, marketByGw),
        greedy: runStrategy(data, "greedy", startIds, origin, marketByGw),
        planner: runStrategy(data, "planner", startIds, origin, marketByGw),
        plannerNoHits: runStrategy(data, "plannerNoHits", startIds, origin, marketByGw),
      };
      rows.push({ profile: skip, origin, res });
    }
  }

  const of = (s: Strategy, f: (r: RunResult) => number) => rows.map((r) => f(r.res[s]));
  const fmt = (n: number, dp = 1) => n.toFixed(dp).padStart(7);

  console.log(
    `\n=== STRATEGY COMPARISON — actual points over ${WEEKS} GWs ===\n` +
      `${rows.length} simulated windows (origins GW${FIRST_ORIGIN}–${LAST_ORIGIN} × ` +
      `${SKIP_PROFILES.length} squad profiles)\n`,
  );
  console.log("strategy      mean pts   vs pat   vs greedy   transfers   hits");
  console.log("---------------------------------------------------------------");
  const patMean = mean(of("pat", (r) => r.actual));
  const greedyMean = mean(of("greedy", (r) => r.actual));
  const plannerMean = mean(of("planner", (r) => r.actual));
  const row = (name: string, m: number, s: Strategy) =>
    console.log(
      `${name.padEnd(12)} ${fmt(m)}  ${fmt(m - patMean)}   ${fmt(m - greedyMean)}   ` +
        `${fmt(mean(of(s, (r) => r.transfers)))}  ${fmt(mean(of(s, (r) => r.hits)))}`,
    );
  row("pat", patMean, "pat");
  row("greedy", greedyMean, "greedy");
  row("planner", plannerMean, "planner");
  row("planner −hits", mean(of("plannerNoHits", (r) => r.actual)), "plannerNoHits");

  // Head-to-head: how often does the planner actually come out ahead?
  const wins = rows.filter((r) => r.res.planner.actual > r.res.greedy.actual).length;
  const draws = rows.filter((r) => r.res.planner.actual === r.res.greedy.actual).length;
  const diffs = rows.map((r) => r.res.planner.actual - r.res.greedy.actual);
  const sorted = [...diffs].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const md = mean(diffs);
  const sd = Math.sqrt(mean(diffs.map((d) => (d - md) ** 2)) * (diffs.length / (diffs.length - 1)));
  const se = sd / Math.sqrt(diffs.length);
  console.log(
    `\nplanner vs greedy: won ${wins}, drew ${draws}, lost ${rows.length - wins - draws} ` +
      `of ${rows.length} windows`,
  );
  console.log(
    `per-window diff: mean ${md.toFixed(2)}, median ${median.toFixed(1)}, ` +
      `best +${Math.max(...diffs)}, worst ${Math.min(...diffs)}`,
  );
  console.log(
    `spread: sd ${sd.toFixed(1)}, se ${se.toFixed(1)}, t ${(md / se).toFixed(2)}, ` +
      `95% CI [${(md - 1.96 * se).toFixed(1)}, ${(md + 1.96 * se).toFixed(1)}]`,
  );
  console.log(
    "(windows overlap and share a season, so even this CI flatters the result)",
  );

  console.log("\nBy squad profile (mean actual pts):");
  console.log("profile        pat   greedy  planner  plan−hits");
  for (const skip of SKIP_PROFILES) {
    const sub = rows.filter((r) => r.profile === skip);
    const m = (s: Strategy) => mean(sub.map((r) => r.res[s].actual));
    console.log(
      `skip ${String(skip).padEnd(9)} ${fmt(m("pat"))} ${fmt(m("greedy"))} ${fmt(m("planner"))} ` +
        `${fmt(m("plannerNoHits"))}`,
    );
  }
}

main();

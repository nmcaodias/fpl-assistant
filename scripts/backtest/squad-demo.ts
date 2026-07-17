/**
 * Run the initial-squad optimizer on reconstructed gameweeks of last season
 * and score its pick on points actually scored — the same no-lookahead rules
 * as every other harness here. Two baselines for scale: the skip-profile
 * template squads from strategy-compare, and (for honesty about the metric)
 * the best-hindsight XI is deliberately NOT shown, since nothing can pick it.
 *
 *   npx tsx scripts/backtest/squad-demo.ts [gw] [budgetTenths]
 */
import { bestXi } from "../../src/lib/planner";
import { projectPlayers } from "../../src/lib/projection";
import type { PlayerProjection } from "../../src/lib/projection";
import { buildSquad } from "../../src/lib/squad-builder";
import { TRANSFER_HORIZON } from "./config";
import { actualOverHorizon, loadData, reconstructGw } from "./reconstruct";

const gw = parseInt(process.argv[2] ?? "10", 10);
const budget = parseInt(process.argv[3] ?? "1000", 10);

const data = loadData();
const { players, ctx, recent } = reconstructGw(data, gw);
const market = projectPlayers(players, ctx, TRANSFER_HORIZON, recent);

const t0 = performance.now();
const squad = buildSquad(market, budget);
const ms = performance.now() - t0;
if (!squad) {
  console.log("No legal squad found");
  process.exit(1);
}

const actual = (p: PlayerProjection) =>
  actualOverHorizon(data, p.player.id, gw, TRANSFER_HORIZON);
const price = (p: PlayerProjection) => `£${(p.player.now_cost / 10).toFixed(1)}m`;
const pos = ["", "GK ", "DEF", "MID", "FWD"];

console.log(
  `\nSquad for GW${gw}–${gw + TRANSFER_HORIZON - 1}, budget £${(budget / 10).toFixed(1)}m ` +
    `(built in ${ms.toFixed(0)}ms)\n`,
);
console.log("Starting XI:");
for (const p of squad.starters) {
  const cap = p.player.id === squad.captain.player.id ? " (C)" : "";
  console.log(
    `  ${pos[p.player.element_type]} ${p.player.web_name.padEnd(16)} ${price(p).padStart(7)}  ` +
      `proj ${p.horizonEp.toFixed(1).padStart(5)}  actual ${String(actual(p)).padStart(3)}${cap}`,
  );
}
console.log("Bench:");
for (const p of squad.bench) {
  console.log(
    `  ${pos[p.player.element_type]} ${p.player.web_name.padEnd(16)} ${price(p).padStart(7)}  ` +
      `proj ${p.horizonEp.toFixed(1).padStart(5)}  actual ${String(actual(p)).padStart(3)}`,
  );
}
console.log(
  `\nSpend £${(squad.costTenths / 10).toFixed(1)}m, bank £${(squad.bankTenths / 10).toFixed(1)}m`,
);

// Score the XI it picked on actual points, captain doubled.
const xiActual = squad.starters.reduce((s, p) => s + actual(p), 0) + actual(squad.captain);
console.log(`XI actual points over ${TRANSFER_HORIZON} GWs (captain doubled): ${xiActual}`);

// Baseline: the strategy-compare template squads (top players by season points
// with `skip` best skipped per position), scored the same way.
for (const skip of [0, 3]) {
  const byPoints = [...market.values()].sort(
    (a, b) => b.player.total_points - a.player.total_points,
  );
  const ids: number[] = [];
  const clubs: Record<number, number> = {};
  for (const [posN, quota] of [[1, 2], [2, 5], [3, 5], [4, 3]] as const) {
    let skipped = 0;
    let takenN = 0;
    for (const p of byPoints) {
      if (p.player.element_type !== posN) continue;
      if (skipped < skip) {
        skipped++;
        continue;
      }
      if ((clubs[p.player.team] ?? 0) >= 3) continue;
      ids.push(p.player.id);
      clubs[p.player.team] = (clubs[p.player.team] ?? 0) + 1;
      if (++takenN >= quota) break;
    }
  }
  const squadPs = ids.map((id) => market.get(id)!);
  const xi = bestXi(squadPs, (p) => p.horizonEp);
  const capt = xi.reduce((b, p) => (p.horizonEp > b.horizonEp ? p : b), xi[0]);
  const pts = xi.reduce((s, p) => s + actual(p), 0) + actual(capt);
  const spend = squadPs.reduce((s, p) => s + p.player.now_cost, 0);
  console.log(
    `Template (skip ${skip}): ${pts} actual pts, spend £${(spend / 10).toFixed(1)}m` +
      (spend > budget ? "  [over budget!]" : ""),
  );
}

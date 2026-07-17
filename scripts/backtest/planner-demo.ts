/**
 * Run the transfer planner on a reconstructed gameweek of last season, so its
 * plans can be sanity-checked against real players and real fixtures — the
 * live API has no fixtures between seasons, which makes this the only way to
 * see the planner act outside unit tests.
 *
 *   npm run backtest:fetch   # once, if scripts/backtest/data is empty
 *   npx tsx scripts/backtest/planner-demo.ts [gw] [freeTransfers] [bank]
 */
import { planTransfers } from "../../src/lib/planner";
import { projectPlayers } from "../../src/lib/projection";
import type { PlayerProjection } from "../../src/lib/projection";
import type { Position } from "../../src/lib/types";
import { loadData, reconstructGw, actualOverHorizon } from "./reconstruct";

const gw = parseInt(process.argv[2] ?? "20", 10);
const freeTransfers = parseInt(process.argv[3] ?? "1", 10);
const bankTenths = parseInt(process.argv[4] ?? "5", 10);
const WEEKS = 5;

const data = loadData();
const { players, ctx, recent } = reconstructGw(data, gw);
const market = projectPlayers(players, ctx, WEEKS, recent);

// A plausible mid-table squad: for each position, skip the very best (a real
// squad rarely has them all) and take the next players by season points,
// respecting the 3-per-club cap and a budget-ish spread.
const SKIP = 3;
const QUOTAS: [Position, number][] = [[1, 2], [2, 5], [3, 5], [4, 3]];
const byPoints = [...market.values()].sort(
  (a, b) => b.player.total_points - a.player.total_points,
);
const squadIds: number[] = [];
const clubCount: Record<number, number> = {};
for (const [pos, quota] of QUOTAS) {
  let skipped = 0;
  let taken = 0;
  for (const p of byPoints) {
    if (p.player.element_type !== pos) continue;
    if (skipped < SKIP) {
      skipped++;
      continue;
    }
    if ((clubCount[p.player.team] ?? 0) >= 3) continue;
    squadIds.push(p.player.id);
    clubCount[p.player.team] = (clubCount[p.player.team] ?? 0) + 1;
    if (++taken >= quota) break;
  }
}

const name = (p: PlayerProjection) => p.player.web_name;
const price = (p: PlayerProjection) => `£${(p.player.now_cost / 10).toFixed(1)}m`;

console.log(`\nPlanning GW${gw}–${gw + WEEKS - 1} | ${freeTransfers} FT | bank £${(bankTenths / 10).toFixed(1)}m`);
console.log("Squad:", squadIds.map((id) => name(market.get(id)!)).join(", "));

const t0 = performance.now();
const plan = planTransfers(squadIds, market, ctx, {
  freeTransfers,
  bankTenths,
  weeks: WEEKS,
});
const elapsed = performance.now() - t0;

if (!plan) {
  console.log("No plan (between seasons?)");
  process.exit(0);
}

console.log(`\nPlan (found in ${elapsed.toFixed(0)}ms):`);
for (const w of plan.weeks) {
  const moves =
    w.moves.length === 0
      ? "— hold"
      : w.moves
          .map((m) => `${name(m.out)} → ${name(m.in)} (${price(m.in)}, +${m.gain})`)
          .join("; ");
  const hit = w.hitCost > 0 ? ` | HIT −${w.hitCost}` : "";
  console.log(
    `  GW${w.gw}  [${w.freeTransfers} FT]  ${moves}${hit}  | XI ${w.xiEp} xPts | bank £${(w.bankAfter / 10).toFixed(1)}m`,
  );
}
console.log(
  `\nTotal ${plan.totalEp} xPts vs standing pat ${plan.baselineEp} -> +${plan.gain} (hits ${plan.totalHitCost})`,
);

// What the plan's buys actually went on to score (the answer key).
const buys = plan.weeks.flatMap((w) =>
  w.moves.map((m) => ({ week: w.gw, in: m.in, out: m.out })),
);
if (buys.length > 0) {
  console.log("\nHow the swaps actually panned out (real points to end of window):");
  for (const b of buys) {
    const horizon = gw + WEEKS - b.week;
    const inActual = actualOverHorizon(data, b.in.player.id, b.week, horizon);
    const outActual = actualOverHorizon(data, b.out.player.id, b.week, horizon);
    const delta = inActual - outActual;
    console.log(
      `  GW${b.week} ${name(b.out)} → ${name(b.in)}: actual ${outActual} vs ${inActual} (${delta >= 0 ? "+" : ""}${delta})`,
    );
  }
}

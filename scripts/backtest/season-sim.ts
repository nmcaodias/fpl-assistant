/**
 * Play a whole season with the app's advice and count what it actually scored.
 *
 * Starts at GW6 — before that the engine has no football to project from, since
 * FPL's data resets each summer (this is the app's real cold start, not a
 * shortcut). Each week: pick the XI and captain from projections, take the free
 * transfer if the best swap clears the noise floor, never take a hit (backtested
 * as a loser). Everything is decided on projections rebuilt with no lookahead;
 * only scoring reads actuals.
 *
 * Auto-subs are modelled, since the real game gives them to you for free and
 * leaving them out would understate the score by a lot. What is left out is
 * deliberately conservative — each omission costs us points rather than
 * inventing them:
 *   - no chips at all (no Triple Captain, Bench Boost, Free Hit, Wildcard)
 *   - no price changes, so no team-value growth to spend
 *   - vice-captaincy: if the captain blanks, no fallback
 *
 *   npx tsx scripts/backtest/season-sim.ts
 */
import { readFileSync } from "node:fs";
import { bestXi, MAX_FREE_TRANSFERS } from "../../src/lib/planner";
import { projectPlayers } from "../../src/lib/projection";
import type { PlayerProjection } from "../../src/lib/projection";
import { buildSquad } from "../../src/lib/squad-builder";
import { DATA_DIR, FIRST_SCORED_GW, TRANSFER_HORIZON } from "./config";
import { actualForGw, loadData, reconstructGw, TOTAL_GWS } from "./reconstruct";

const START_GW = FIRST_SCORED_GW;
const BUDGET = 1000;
/** Mirrors the planner's noise floor: below this a swap isn't worth the churn. */
const MIN_MOVE_GAIN = 1.5;

type Market = Map<number, PlayerProjection>;

const events = (
  JSON.parse(readFileSync(`${DATA_DIR}/bootstrap.json`, "utf8")) as {
    events: { id: number; average_entry_score: number; ranked_count: number }[];
  }
).events;

const data = loadData();

console.log(`Projecting GW${START_GW}–${TOTAL_GWS} (no lookahead)…`);
const marketByGw = new Map<number, Market>();
for (let gw = START_GW; gw <= TOTAL_GWS; gw++) {
  const { players, ctx, recent } = reconstructGw(data, gw);
  marketByGw.set(gw, projectPlayers(players, ctx, TRANSFER_HORIZON, recent));
}

// --- Build the opening squad the way /squad would ---
const opening = buildSquad(marketByGw.get(START_GW)!, BUDGET);
if (!opening) throw new Error("no legal opening squad");
const squad = new Set([...opening.starters, ...opening.bench].map((p) => p.player.id));
let bank = opening.bankTenths;
let ft = 1;

console.log(
  `\nOpening squad (GW${START_GW}, £${(opening.costTenths / 10).toFixed(1)}m): ` +
    [...opening.starters, ...opening.bench].map((p) => p.player.web_name).join(", "),
);

const teamCount = (market: Market, ids: Set<number>, team: number, excluding: number) => {
  let n = 0;
  for (const id of ids) {
    if (id === excluding) continue;
    if (market.get(id)?.player.team === team) n++;
  }
  return n;
};

function bestSwap(market: Market, ids: Set<number>, bankNow: number) {
  let best: { out: PlayerProjection; in: PlayerProjection; gain: number } | null = null;
  for (const outId of ids) {
    const o = market.get(outId);
    if (!o) continue;
    const budget = o.player.now_cost + bankNow;
    for (const c of market.values()) {
      if (c.player.element_type !== o.player.element_type) continue;
      if (ids.has(c.player.id)) continue;
      if (c.player.now_cost > budget) continue;
      if (c.xMins < 45) continue;
      if (c.player.status === "u" || c.player.status === "n") continue;
      if (teamCount(market, ids, c.player.team, outId) >= 3) continue;
      const gain = c.horizonEp - o.horizonEp;
      if (!best || gain > best.gain) best = { out: o, in: c, gain };
    }
  }
  return best;
}

/** A formation is legal with exactly 1 GK and at least 3 DEF, 2 MID, 1 FWD. */
function legalXi(xi: PlayerProjection[]): boolean {
  const n = (pos: number) => xi.filter((p) => p.player.element_type === pos).length;
  return xi.length === 11 && n(1) === 1 && n(2) >= 3 && n(3) >= 2 && n(4) >= 1;
}

/**
 * FPL's auto-subs: a starter who didn't play is replaced by the first bench
 * player who did, in bench order, provided the formation stays legal. The
 * keeper can only be replaced by the other keeper.
 */
function applyAutoSubs(
  gw: number,
  xi: PlayerProjection[],
  bench: PlayerProjection[],
): PlayerProjection[] {
  const played = (p: PlayerProjection) => actualForGw(data, p.player.id, gw).minutes > 0;
  let current = [...xi];
  const available = bench.filter(played);

  for (const blank of xi.filter((p) => !played(p))) {
    const isGk = blank.player.element_type === 1;
    const candidate = available.find((b) => {
      if (isGk !== (b.player.element_type === 1)) return false;
      return legalXi(current.map((p) => (p.player.id === blank.player.id ? b : p)));
    });
    if (!candidate) continue;
    current = current.map((p) => (p.player.id === blank.player.id ? candidate : p));
    available.splice(available.indexOf(candidate), 1);
  }
  return current;
}

// --- Play the season ---
let total = 0;
let transfers = 0;
const weekly: { gw: number; pts: number; avg: number }[] = [];

for (let gw = START_GW; gw <= TOTAL_GWS; gw++) {
  const market = marketByGw.get(gw)!;

  // A player can vanish from the pool (e.g. left the league); replace for free.
  for (const id of [...squad]) {
    if (!market.has(id)) squad.delete(id);
  }

  const swap = bestSwap(market, squad, bank);
  if (swap && ft > 0 && swap.gain >= MIN_MOVE_GAIN) {
    squad.delete(swap.out.player.id);
    squad.add(swap.in.player.id);
    bank += swap.out.player.now_cost - swap.in.player.now_cost;
    ft--;
    transfers++;
  }
  ft = Math.min(ft + 1, MAX_FREE_TRANSFERS);

  const squadPs = [...squad]
    .map((id) => market.get(id))
    .filter((p): p is PlayerProjection => p !== undefined);
  const ep = (p: PlayerProjection) => p.perGw[0]?.ep ?? 0;
  const picked = bestXi(squadPs, ep);
  const pickedIds = new Set(picked.map((p) => p.player.id));
  const bench = squadPs
    .filter((p) => !pickedIds.has(p.player.id))
    .sort((a, b) => ep(b) - ep(a)); // bench order = our own ranking
  const captain = picked.reduce((b, p) => (ep(p) > ep(b) ? p : b), picked[0]);

  const xi = applyAutoSubs(gw, picked, bench);
  const pts =
    xi.reduce((s, p) => s + actualForGw(data, p.player.id, gw).points, 0) +
    actualForGw(data, captain.player.id, gw).points; // captain doubled
  total += pts;

  const avg = events.find((e) => e.id === gw)?.average_entry_score ?? 0;
  weekly.push({ gw, pts, avg });
}

// --- Report ---
const avgTotal = weekly.reduce((s, w) => s + w.avg, 0);
const beat = weekly.filter((w) => w.pts > w.avg).length;

console.log(`\n=== SEASON 2025/26, GW${START_GW}–${TOTAL_GWS} ===`);
console.log(`app's advice:     ${total} pts  (${transfers} transfers, 0 hits, no chips)`);
console.log(`average manager:  ${avgTotal} pts`);
console.log(`difference:       ${total - avgTotal > 0 ? "+" : ""}${total - avgTotal} pts`);
console.log(`beat the average in ${beat} of ${weekly.length} gameweeks`);

const avgFull = events.reduce((s, e) => s + e.average_entry_score, 0);
const missed = events
  .filter((e) => e.id < START_GW)
  .reduce((s, e) => s + e.average_entry_score, 0);
console.log(
  `\nGW1–${START_GW - 1} can't be modelled (no data yet that season); the average ` +
    `manager scored ${missed} there.`,
);
console.log(
  `Assuming an average start, a full season projects ~${total + missed} pts ` +
    `vs the average manager's ${avgFull}.`,
);
console.log(`(${(events[0].ranked_count / 1e6).toFixed(1)}M ranked managers)`);

// Real 2025/26 finishing thresholds, read off the overall league (id 314) via
//   /api/leagues-classic/314/standings/?page_standings=N   (50 entries a page)
// on 2026-07-17. Same season as the simulation, so these are the right ladder.
const LADDER: [rank: number, points: number][] = [
  [1, 2582],
  [9_946, 2398],
  [99_904, 2327],
  [399_180, 2258],
  [999_835, 2191],
  [1_999_333, 2117],
  [2_999_772, 2057],
  [3_999_925, 2002],
  [4_999_676, 1949],
  [5_999_623, 1895],
  [6_999_671, 1838],
];

/** Log-linear interpolation on rank — the ladder is far from linear. */
function rankFor(points: number): number | null {
  if (points >= LADDER[0][1]) return LADDER[0][0];
  for (let i = 0; i < LADDER.length - 1; i++) {
    const [r1, p1] = LADDER[i];
    const [r2, p2] = LADDER[i + 1];
    if (points <= p1 && points >= p2) {
      const t = (p1 - points) / (p1 - p2);
      return Math.round(Math.exp(Math.log(r1) + t * (Math.log(r2) - Math.log(r1))));
    }
  }
  return null;
}

const projected = total + missed;
const rank = rankFor(projected);
const field = events[0].ranked_count;
console.log("\n=== ESTIMATED FINISH (2025/26 ladder, real thresholds) ===");
if (rank) {
  console.log(
    `~${projected} pts -> rank ~${(rank / 1e6).toFixed(2)}M of ${(field / 1e6).toFixed(1)}M ` +
      `(top ${((rank / field) * 100).toFixed(0)}%)`,
  );
}
console.log("Ladder for reference:");
for (const [r, p] of LADDER.slice(1)) {
  console.log(`  ${String(p).padStart(4)} pts = rank ${(r / 1e6).toFixed(2)}M`);
}
console.log(
  "\nChips are NOT simulated and are worth real points — this is a floor, not a ceiling.",
);

console.log("\nWorst and best weeks vs average:");
const sorted = [...weekly].sort((a, b) => a.pts - a.avg - (b.pts - b.avg));
for (const w of [...sorted.slice(0, 3), ...sorted.slice(-3)]) {
  console.log(`  GW${String(w.gw).padStart(2)}: ${String(w.pts).padStart(3)} vs avg ${w.avg}`);
}

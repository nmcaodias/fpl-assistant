/**
 * Fit and validate a recalibration of the engine's raw xPts.
 *
 * The backtest showed the raw projection is over-spread: the top decile was
 * predicted 25.9 over five gameweeks and scored 19.2, while the bottom decile
 * was predicted 2.2 and scored 8.0. That's regression to the mean — the model
 * is too confident at both ends. Ranking is unaffected (a straight line is
 * monotone, so the transfer order is identical), but every decision that reads
 * an *absolute* gap is distorted: "worth a −4 hit" fires when the true gap is
 * nowhere near 4, and the planner spends hits on it.
 *
 * The correction has the form `pred -> a + b*pred`, fitted by least squares.
 *
 * It's fitted at two levels, because they answer different questions and need
 * not agree. Per-gameweek is what the planner reads week by week. The 5-week
 * horizon is what "worth a −4 hit" reads — and because a player's five weekly
 * projections are near-copies of each other, a systematic per-player bias
 * compounds across the sum while the actuals' week-to-week noise partly
 * cancels. If the horizon is more over-spread than the weeks it's built from,
 * calibrating per-gameweek alone would under-correct the hit maths.
 *
 * Fitting on the season we then score would be lookahead, so the honest test is
 * walk-forward: for each gameweek fit on strictly earlier gameweeks only, and
 * score the correction on the gameweek it never saw.
 *
 *   npx tsx scripts/backtest/calibrate.ts
 */
import { projectPlayers } from "../../src/lib/projection";
import { FIRST_SCORED_GW, MIN_PRIOR_APPEARANCES, TRANSFER_HORIZON } from "./config";
import { mae, mean, rmse, spearman } from "./metrics";
import {
  actualForGw,
  actualOverHorizon,
  loadData,
  reconstructGw,
  TOTAL_GWS,
} from "./reconstruct";

/** Gameweeks of history required before a fitted correction is trusted. */
const MIN_FIT_GWS = 6;

interface Row {
  gw: number;
  pred: number;
  actual: number;
  hasFixture: boolean;
}

/** Ordinary least squares of y on x. */
function ols(xs: number[], ys: number[]): { a: number; b: number } {
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < xs.length; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const b = sxx === 0 ? 1 : sxy / sxx;
  return { a: my - b * mx, b };
}

const apply = (c: { a: number; b: number }, pred: number, hasFixture: boolean) =>
  hasFixture ? Math.max(0, c.a + c.b * pred) : 0;

function main() {
  const data = loadData();
  console.log("Projecting each gameweek (no lookahead)…");

  const rows: Row[] = [];
  const horizon: { gw: number; pred: number; actual: number }[] = [];
  for (let gw = FIRST_SCORED_GW; gw <= TOTAL_GWS; gw++) {
    const { players, ctx, recent, priorAppearances } = reconstructGw(data, gw);
    const proj = projectPlayers(players, ctx, TRANSFER_HORIZON, recent);
    const horizonFits = gw <= TOTAL_GWS - TRANSFER_HORIZON + 1;
    for (const p of proj.values()) {
      if ((priorAppearances.get(p.player.id) ?? 0) < MIN_PRIOR_APPEARANCES) continue;
      const week = p.perGw[0];
      rows.push({
        gw,
        pred: week?.ep ?? 0,
        actual: actualForGw(data, p.player.id, gw).points,
        hasFixture: (week?.fixtures.length ?? 0) > 0,
      });
      if (horizonFits) {
        horizon.push({
          gw,
          pred: p.horizonEp,
          actual: actualOverHorizon(data, p.player.id, gw, TRANSFER_HORIZON),
        });
      }
    }
  }

  // Blanks are structural zeros, not mispredictions — fitting on them would
  // drag the line toward the origin for reasons that have nothing to do with
  // how the model rates a player who is actually playing.
  const playing = rows.filter((r) => r.hasFixture);
  console.log(
    `\n${rows.length} player-GWs (${playing.length} with a fixture, ` +
      `${rows.length - playing.length} blanks held at 0)`,
  );

  const full = ols(playing.map((r) => r.pred), playing.map((r) => r.actual));

  console.log("\n=== IN-SAMPLE FIT (whole season — the number to ship, see below) ===");
  console.log(`per-GW  : actual ≈ ${full.a.toFixed(3)} + ${full.b.toFixed(3)} × pred`);
  console.log(
    `          pool mean pred ${mean(playing.map((r) => r.pred)).toFixed(2)}, ` +
      `actual ${mean(playing.map((r) => r.actual)).toFixed(2)}`,
  );

  // The level "worth a −4 hit" actually reads.
  const hz = ols(horizon.map((r) => r.pred), horizon.map((r) => r.actual));
  console.log(`horizon : actual ≈ ${hz.a.toFixed(3)} + ${hz.b.toFixed(3)} × pred  (${horizon.length} obs)`);
  console.log(
    `          summing the per-GW fit over ${TRANSFER_HORIZON} weeks would imply ` +
      `a ≈ ${(full.a * TRANSFER_HORIZON).toFixed(2)}, b = ${full.b.toFixed(3)}`,
  );
  console.log(
    `          -> a raw +8 horizon edge is really +${(8 * hz.b).toFixed(1)} by the horizon fit, ` +
      `+${(8 * full.b).toFixed(1)} by the per-GW one`,
  );

  // --- Walk-forward: fit on earlier gameweeks only, score on the next one ---
  // Two candidate per-GW corrections:
  //   perGw   — the per-GW OLS fit: best for a single week, but summed over the
  //             horizon it leaves the transfer gap over-spread
  //   fromHz  — the horizon fit divided across the weeks (a/5, b). Slightly
  //             worse weekly, but makes horizonEp = Σ perGw land on the horizon
  //             fit exactly, which is the number "worth a −4" actually reads
  const wf: { raw: number[]; perGw: number[]; fromHz: number[]; actual: number[] } = {
    raw: [],
    perGw: [],
    fromHz: [],
    actual: [],
  };
  // Horizon-level, scored on windows whose fit never saw them.
  const wfHz: { raw: number[]; perGw: number[]; fromHz: number[]; actual: number[] } = {
    raw: [],
    perGw: [],
    fromHz: [],
    actual: [],
  };
  const coefByGw: { gw: number; a: number; b: number; hzB: number }[] = [];

  for (let gw = FIRST_SCORED_GW + MIN_FIT_GWS; gw <= TOTAL_GWS; gw++) {
    const past = rows.filter((r) => r.gw < gw && r.hasFixture);
    const now = rows.filter((r) => r.gw === gw);
    if (past.length < 200 || now.length === 0) continue;

    const cPerGw = ols(past.map((r) => r.pred), past.map((r) => r.actual));
    // Horizon windows are only safely "past" once they've fully resolved.
    const pastHz = horizon.filter((r) => r.gw + TRANSFER_HORIZON <= gw);
    const cHz =
      pastHz.length >= 200
        ? ols(pastHz.map((r) => r.pred), pastHz.map((r) => r.actual))
        : cPerGw;
    const cFromHz = { a: cHz.a / TRANSFER_HORIZON, b: cHz.b };
    coefByGw.push({ gw, a: cPerGw.a, b: cPerGw.b, hzB: cHz.b });

    for (const r of now) {
      wf.raw.push(r.hasFixture ? r.pred : 0);
      wf.perGw.push(apply(cPerGw, r.pred, r.hasFixture));
      wf.fromHz.push(apply(cFromHz, r.pred, r.hasFixture));
      wf.actual.push(r.actual);
    }
    for (const r of horizon.filter((h) => h.gw === gw)) {
      // A horizon prediction is the sum of five calibrated weeks, so the
      // per-week intercept lands five times — exactly as it would in the app.
      wfHz.raw.push(r.pred);
      wfHz.perGw.push(cPerGw.a * TRANSFER_HORIZON + cPerGw.b * r.pred);
      wfHz.fromHz.push(cHz.a + cHz.b * r.pred);
      wfHz.actual.push(r.actual);
    }
  }

  console.log(`\n=== WALK-FORWARD, PER GAMEWEEK (fit on GWs < N, scored on N) — ${wf.actual.length} obs ===`);
  console.log("correction     MAE    RMSE   spearman");
  console.log("--------------------------------------");
  const line = (name: string, pred: number[], actual: number[]) =>
    console.log(
      `${name.padEnd(12)} ${mae(pred, actual).toFixed(3)}  ${rmse(pred, actual).toFixed(3)}  ` +
        `${spearman(pred, actual).toFixed(3)}`,
    );
  line("raw", wf.raw, wf.actual);
  line("perGw fit", wf.perGw, wf.actual);
  line("from horizon", wf.fromHz, wf.actual);
  console.log("(spearman is unchanged by construction — a line can't reorder anything)");

  console.log(`\n=== WALK-FORWARD, 5-GW HORIZON — the level "worth a −4" reads — ${wfHz.actual.length} obs ===`);
  console.log("correction     MAE    RMSE");
  console.log("---------------------------");
  const line2 = (name: string, pred: number[]) =>
    console.log(
      `${name.padEnd(12)} ${mae(pred, wfHz.actual).toFixed(3)}  ${rmse(pred, wfHz.actual).toFixed(3)}`,
    );
  line2("raw", wfHz.raw);
  line2("perGw fit", wfHz.perGw);
  line2("from horizon", wfHz.fromHz);

  const first = coefByGw[0];
  const last = coefByGw[coefByGw.length - 1];
  console.log(
    `\nper-GW slope drifts ${first.b.toFixed(3)} (GW${first.gw}) -> ${last.b.toFixed(3)} ` +
      `(GW${last.gw}); intercept ${first.a.toFixed(2)} -> ${last.a.toFixed(2)}`,
  );
  console.log(
    `horizon slope drifts ${first.hzB.toFixed(3)} -> ${last.hzB.toFixed(3)}`,
  );
  console.log(
    "Stability matters: coefficients fitted on last season are only worth " +
      "shipping if they aren't chasing the sample.",
  );

  console.log("\n=== SHIP THESE (fitted on the full season, for use on the next one) ===");
  console.log(`CALIBRATION_INTERCEPT = ${(hz.a / TRANSFER_HORIZON).toFixed(3)}   // horizon fit ${hz.a.toFixed(3)} spread over ${TRANSFER_HORIZON} weeks`);
  console.log(`CALIBRATION_SLOPE     = ${hz.b.toFixed(3)}`);
  console.log(
    `\nEffect on a transfer gap: a raw +8 xPts edge becomes ` +
      `+${(8 * hz.b).toFixed(1)} — the hit maths changes, the order doesn't.`,
  );
}

main();

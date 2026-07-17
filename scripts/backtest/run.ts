/**
 * Walk-forward backtest of the xPts engine over last season.
 *
 * For each gameweek the engine's inputs are rebuilt from earlier rounds only
 * (see reconstruct.ts), the real projection.ts is run, and its output is scored
 * against what actually happened. Two questions:
 *
 *   1. Projection accuracy — does a player's projected xPts track the points
 *      he actually scored that gameweek?
 *   2. Transfer decisions  — do the players it ranks highest over the next few
 *      gameweeks actually outscore the ones it ranks low?
 *
 * Both are compared with naive baselines (season points-per-game, recent form),
 * because a correlation only means something next to what simpler numbers get.
 *
 *   npm run backtest
 */
import { writeFileSync } from "node:fs";
import { projectPlayers } from "../../src/lib/projection";
import {
  FIRST_SCORED_GW,
  MIN_PRIOR_APPEARANCES,
  TRANSFER_HORIZON,
} from "./config";
import {
  calibration,
  decileLift,
  mae,
  mean,
  pearson,
  rmse,
  spearman,
} from "./metrics";
import {
  actualForGw,
  actualOverHorizon,
  loadData,
  reconstructGw,
  TOTAL_GWS,
  type BacktestData,
} from "./reconstruct";

const num = (s: string) => parseFloat(s) || 0;

/** One projected/actual observation for a player in a gameweek. */
interface Obs {
  gw: number;
  engine: number; // engine's single-GW xPts (with Phase 2 recent windows)
  engineNoRecent: number; // same engine, season rates + form only (ablation)
  ppg: number; // baseline: season points-per-game to date
  form: number; // baseline: recent form
  actual: number;
  appeared: boolean;
}

interface HorizonObs {
  gw: number;
  engineHorizon: number;
  engineNoRecentHorizon: number;
  ppgHorizon: number;
  formHorizon: number;
  actualHorizon: number;
}

function collect(data: BacktestData) {
  const acc: Obs[] = [];
  const horizon: HorizonObs[] = [];

  for (let gw = FIRST_SCORED_GW; gw <= TOTAL_GWS; gw++) {
    const { players, ctx, recent, priorAppearances } = reconstructGw(data, gw);
    // Horizon needs `TRANSFER_HORIZON` gameweeks of actuals ahead of `gw`.
    const horizonFits = gw <= TOTAL_GWS - TRANSFER_HORIZON + 1;
    const proj = projectPlayers(players, ctx, TRANSFER_HORIZON, recent);
    // Ablation: same engine without the Phase 2 recent-match windows.
    const projNoRecent = projectPlayers(players, ctx, TRANSFER_HORIZON);

    for (const p of proj.values()) {
      const id = p.player.id;
      if ((priorAppearances.get(id) ?? 0) < MIN_PRIOR_APPEARANCES) continue;

      const noRecent = projNoRecent.get(id);
      const a = actualForGw(data, id, gw);
      acc.push({
        gw,
        engine: p.perGw[0]?.ep ?? 0,
        engineNoRecent: noRecent?.perGw[0]?.ep ?? 0,
        ppg: num(p.player.points_per_game),
        form: num(p.player.form),
        actual: a.points,
        appeared: a.appeared,
      });

      if (horizonFits) {
        horizon.push({
          gw,
          engineHorizon: p.horizonEp,
          engineNoRecentHorizon: noRecent?.horizonEp ?? 0,
          ppgHorizon: num(p.player.points_per_game) * TRANSFER_HORIZON,
          formHorizon: num(p.player.form) * TRANSFER_HORIZON,
          actualHorizon: actualOverHorizon(data, id, gw, TRANSFER_HORIZON),
        });
      }
    }
  }
  return { acc, horizon };
}

function fmt(n: number, dp = 3) {
  return Number.isNaN(n) ? "  n/a" : n.toFixed(dp);
}

function accuracyReport(acc: Obs[]) {
  const actual = acc.map((o) => o.actual);
  const scoreOf = (pred: number[]) => ({
    pearson: pearson(pred, actual),
    spearman: spearman(pred, actual),
    mae: mae(pred, actual),
    rmse: rmse(pred, actual),
  });

  const engine = scoreOf(acc.map((o) => o.engine));
  const engineNoRecent = scoreOf(acc.map((o) => o.engineNoRecent));
  const ppg = scoreOf(acc.map((o) => o.ppg));
  const form = scoreOf(acc.map((o) => o.form));

  // Conditional on the player actually featuring — isolates rate quality from
  // rotation/injury the backtest can't foresee. Diagnostic only (it filters on
  // an outcome), so it's reported apart from the live-decision numbers.
  const played = acc.filter((o) => o.appeared);
  const enginePlayed = {
    pearson: pearson(played.map((o) => o.engine), played.map((o) => o.actual)),
    spearman: spearman(played.map((o) => o.engine), played.map((o) => o.actual)),
    mae: mae(played.map((o) => o.engine), played.map((o) => o.actual)),
    rmse: rmse(played.map((o) => o.engine), played.map((o) => o.actual)),
  };

  console.log("\n=== 1. PROJECTION ACCURACY (per player-gameweek) ===");
  console.log(`sample: ${acc.length} player-GWs, GW${FIRST_SCORED_GW}–${TOTAL_GWS}\n`);
  console.log("model                 pearson  spearman     MAE    RMSE");
  console.log("-----------------------------------------------------------");
  const row = (name: string, s: ReturnType<typeof scoreOf>) =>
    console.log(
      `${name.padEnd(20)} ${fmt(s.pearson).padStart(7)} ${fmt(s.spearman).padStart(9)} ` +
        `${fmt(s.mae, 2).padStart(7)} ${fmt(s.rmse, 2).padStart(7)}`,
    );
  row("engine (xPts)", engine);
  row("engine no-recent", engineNoRecent);
  row("baseline: PPG", ppg);
  row("baseline: form", form);
  console.log("-----------------------------------------------------------");
  row("engine | played only", enginePlayed);

  console.log("\nCalibration — mean actual by projected bucket (engine):");
  console.log("bucket      n    meanPred  meanActual");
  for (const b of calibration(acc.map((o) => o.engine), actual, [0, 1, 2, 3, 4, 5, 6, 20])) {
    console.log(
      `${b.label.padEnd(8)} ${String(b.n).padStart(5)}   ${fmt(b.meanPred, 2).padStart(7)}   ${fmt(b.meanActual, 2).padStart(8)}`,
    );
  }

  return { engine, engineNoRecent, ppg, form, enginePlayed, n: acc.length };
}

function transferReport(horizon: HorizonObs[]) {
  const actual = horizon.map((o) => o.actualHorizon);
  const rank = (pred: number[]) => spearman(pred, actual);

  const engineRank = rank(horizon.map((o) => o.engineHorizon));
  const engineNoRecentRank = rank(horizon.map((o) => o.engineNoRecentHorizon));
  const ppgRank = rank(horizon.map((o) => o.ppgHorizon));
  const formRank = rank(horizon.map((o) => o.formHorizon));

  console.log(`\n=== 2. TRANSFER DECISIONS (${TRANSFER_HORIZON}-gameweek horizon) ===`);
  console.log(`sample: ${horizon.length} player-decisions\n`);
  console.log("ranking model            spearman vs actual horizon points");
  console.log("-----------------------------------------------------------");
  console.log(`engine (horizon xPts)   ${fmt(engineRank).padStart(9)}`);
  console.log(`engine no-recent        ${fmt(engineNoRecentRank).padStart(9)}`);
  console.log(`baseline: PPG           ${fmt(ppgRank).padStart(9)}`);
  console.log(`baseline: form          ${fmt(formRank).padStart(9)}`);

  console.log("\nDecile lift — mean actual horizon points by projected decile (engine):");
  console.log("decile      n    meanPred  meanActual");
  const deciles = decileLift(horizon.map((o) => o.engineHorizon), actual, 10);
  for (const d of deciles) {
    console.log(
      `${String(d.bin).padStart(4)}    ${String(d.n).padStart(6)}   ${fmt(d.meanPred, 1).padStart(7)}   ${fmt(d.meanActual, 1).padStart(8)}`,
    );
  }
  const top = deciles[deciles.length - 1].meanActual;
  const bottom = deciles[0].meanActual;
  const overall = mean(actual);
  console.log(
    `\ntop decile ${top.toFixed(1)} vs bottom ${bottom.toFixed(1)} pts ` +
      `(${(top / Math.max(bottom, 0.01)).toFixed(1)}×); overall mean ${overall.toFixed(1)}, ` +
      `top-decile lift ${(top / overall).toFixed(2)}×`,
  );

  return { engineRank, engineNoRecentRank, ppgRank, formRank, deciles, overall, n: horizon.length };
}

function main() {
  const data = loadData();
  console.log(`Loaded ${data.historyById.size} player histories.`);
  const { acc, horizon } = collect(data);

  const accuracy = accuracyReport(acc);
  const transfer = transferReport(horizon);

  const outPath = new URL("./data/results.json", import.meta.url);
  writeFileSync(outPath, JSON.stringify({ accuracy, transfer }, null, 2));
  console.log(`\nMachine-readable results written to ${outPath.pathname}`);
}

main();

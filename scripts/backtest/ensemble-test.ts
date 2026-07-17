/**
 * Do the signals the FPL-analytics papers lean on — ICT index, recency-weighted
 * form, ensembles of the two — improve our transfer ranking when added to the
 * engine, or does the engine already subsume them?
 *
 * Method: walk-forward as ever. For each gameweek, rank players by a blend of
 * the engine's 5-GW horizon xPts with a candidate signal, at a grid of blend
 * weights, and score the ranking by spearman against actual horizon points.
 * Signals are standardised per gameweek before blending so a weight means the
 * same thing everywhere. α = 0 is the shipped engine.
 *
 *   npx tsx scripts/backtest/ensemble-test.ts
 */
import { projectPlayers } from "../../src/lib/projection";
import { FIRST_SCORED_GW, MIN_PRIOR_APPEARANCES, TRANSFER_HORIZON } from "./config";
import { mean, spearman } from "./metrics";
import { actualOverHorizon, loadData, reconstructGw, TOTAL_GWS } from "./reconstruct";

/** ICT lives in the raw cached rows but not in the reconstruct types. */
interface IctRow {
  round: number;
  minutes: number;
  ict_index?: string;
}

interface Obs {
  gw: number;
  engine: number;
  ict90: number; // ICT index per 90 over the recent window
  form: number;
  actual: number;
}

const zscores = (xs: number[]): number[] => {
  const m = mean(xs);
  const sd = Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) || 1;
  return xs.map((x) => (x - m) / sd);
};

function main() {
  const data = loadData();
  console.log("Projecting each gameweek (no lookahead)…");

  const obs: Obs[] = [];
  const lastOrigin = TOTAL_GWS - TRANSFER_HORIZON + 1;
  for (let gw = FIRST_SCORED_GW; gw <= lastOrigin; gw++) {
    const { players, ctx, recent, priorAppearances } = reconstructGw(data, gw);
    const proj = projectPlayers(players, ctx, TRANSFER_HORIZON, recent);
    for (const p of proj.values()) {
      const id = p.player.id;
      if ((priorAppearances.get(id) ?? 0) < MIN_PRIOR_APPEARANCES) continue;

      const prior = ((data.historyById.get(id) ?? []) as unknown as IctRow[]).filter(
        (r) => r.round < gw,
      );
      const window = prior.slice(-5);
      const mins = window.reduce((s, r) => s + r.minutes, 0);
      const ict = window.reduce((s, r) => s + (parseFloat(r.ict_index ?? "0") || 0), 0);

      obs.push({
        gw,
        engine: p.horizonEp,
        ict90: mins > 0 ? (ict / mins) * 90 : 0,
        form: parseFloat(p.player.form) || 0,
        actual: actualOverHorizon(data, id, gw, TRANSFER_HORIZON),
      });
    }
  }
  console.log(`${obs.length} player-decisions, GW${FIRST_SCORED_GW}–${lastOrigin}\n`);

  // Standardise per gameweek, then blend: rank by (1-α)·z(engine) + α·z(signal).
  const byGw = new Map<number, Obs[]>();
  for (const o of obs) {
    if (!byGw.has(o.gw)) byGw.set(o.gw, []);
    byGw.get(o.gw)!.push(o);
  }
  const zEngine: number[] = [];
  const zIct: number[] = [];
  const zForm: number[] = [];
  const actual: number[] = [];
  for (const rows of byGw.values()) {
    const e = zscores(rows.map((r) => r.engine));
    const i = zscores(rows.map((r) => r.ict90));
    const f = zscores(rows.map((r) => r.form));
    rows.forEach((r, k) => {
      zEngine.push(e[k]);
      zIct.push(i[k]);
      zForm.push(f[k]);
      actual.push(r.actual);
    });
  }

  const score = (signal: number[], alpha: number) =>
    spearman(zEngine.map((e, k) => (1 - alpha) * e + alpha * signal[k]), actual);

  console.log("blend weight α      +ICT/90    +form   +ICT&form (α/2 each)");
  console.log("----------------------------------------------------------");
  for (const alpha of [0, 0.1, 0.2, 0.3, 0.4, 0.5]) {
    const both = spearman(
      zEngine.map((e, k) => (1 - alpha) * e + (alpha / 2) * (zIct[k] + zForm[k])),
      actual,
    );
    console.log(
      `${alpha.toFixed(1).padStart(6)}          ${score(zIct, alpha).toFixed(4)}   ${score(zForm, alpha).toFixed(4)}   ${both.toFixed(4)}`,
    );
  }
  console.log("\nPure signals alone:");
  console.log(`  ICT/90 recent  ${spearman(zIct, actual).toFixed(4)}`);
  console.log(`  form           ${spearman(zForm, actual).toFixed(4)}`);
  console.log(`  engine         ${spearman(zEngine, actual).toFixed(4)}`);
}

main();

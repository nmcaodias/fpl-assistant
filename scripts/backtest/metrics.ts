/** Small, dependency-free stats used to score the backtest. */

export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Pearson correlation — linear association between two equal-length series. */
export function pearson(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n === 0 || n !== ys.length) return NaN;
  const mx = mean(xs);
  const my = mean(ys);
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  const denom = Math.sqrt(sxx * syy);
  return denom === 0 ? NaN : sxy / denom;
}

/** Fractional ranks with ties averaged (1-based). */
function ranks(xs: number[]): number[] {
  const order = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    const avg = (i + j) / 2 + 1; // average rank across the tie block
    for (let k = i; k <= j; k++) r[order[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation — monotonic association, robust to scale/outliers. */
export function spearman(xs: number[], ys: number[]): number {
  return pearson(ranks(xs), ranks(ys));
}

export function mae(pred: number[], actual: number[]): number {
  return mean(pred.map((p, i) => Math.abs(p - actual[i])));
}

export function rmse(pred: number[], actual: number[]): number {
  return Math.sqrt(mean(pred.map((p, i) => (p - actual[i]) ** 2)));
}

/**
 * Bucket predictions and report the mean actual in each. A well-calibrated
 * model's mean actual climbs with the predicted bucket and roughly matches it.
 */
export function calibration(
  pred: number[],
  actual: number[],
  edges: number[],
): { label: string; n: number; meanPred: number; meanActual: number }[] {
  const buckets = edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1];
    const idx = pred
      .map((p, j) => (p >= lo && (i === edges.length - 2 ? p <= hi : p < hi) ? j : -1))
      .filter((j) => j >= 0);
    return {
      label: `${lo.toFixed(0)}–${hi.toFixed(0)}`,
      n: idx.length,
      meanPred: mean(idx.map((j) => pred[j])),
      meanActual: mean(idx.map((j) => actual[j])),
    };
  });
  return buckets;
}

/**
 * Split a sample into `k` quto-quantile bins by prediction and report the mean
 * actual per bin. A model that ranks well shows a mean actual that rises
 * monotonically from the bottom bin to the top.
 */
export function decileLift(
  pred: number[],
  actual: number[],
  k = 10,
): { bin: number; n: number; meanPred: number; meanActual: number }[] {
  const order = pred.map((p, i) => i).sort((a, b) => pred[a] - pred[b]);
  const bins: { bin: number; n: number; meanPred: number; meanActual: number }[] = [];
  for (let b = 0; b < k; b++) {
    const lo = Math.floor((b * order.length) / k);
    const hi = Math.floor(((b + 1) * order.length) / k);
    const idx = order.slice(lo, hi);
    bins.push({
      bin: b + 1,
      n: idx.length,
      meanPred: mean(idx.map((j) => pred[j])),
      meanActual: mean(idx.map((j) => actual[j])),
    });
  }
  return bins;
}

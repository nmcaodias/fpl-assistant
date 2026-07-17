/**
 * Pull everything the backtest needs from the live FPL API and cache it to
 * disk, so the walk-forward run is fast, offline, and reproducible.
 *
 * Because the current bootstrap is last season's *final* state (the game is
 * between seasons), one snapshot gives us the full 38-gameweek history: player
 * metadata and season totals from bootstrap, the schedule with results and
 * difficulty from fixtures, and per-match rows from each player's
 * element-summary. Nothing here is time-sensitive — run it once.
 *
 *   npm run backtest:fetch          # relevant players only (default)
 *   npm run backtest:fetch -- --all # every player (~600 requests)
 */
import { mkdir, writeFile } from "node:fs/promises";
import { DATA_DIR, MIN_SEASON_MINUTES } from "./config";

const BASE = "https://fantasy.premierleague.com/api";
const CONCURRENCY = 6;

async function fpl<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "User-Agent": "Mozilla/5.0 (fpl-assistant backtest)" },
  });
  if (!res.ok) throw new Error(`FPL API ${res.status} for ${path}`);
  return (await res.json()) as T;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

async function main() {
  const all = process.argv.includes("--all");
  await mkdir(DATA_DIR, { recursive: true });

  console.log("Fetching bootstrap and fixtures…");
  const [bootstrap, fixtures] = await Promise.all([
    fpl<{ elements: Record<string, unknown>[]; teams: unknown[]; events: unknown[] }>(
      "/bootstrap-static/",
    ),
    fpl<unknown[]>("/fixtures/"),
  ]);
  await writeFile(`${DATA_DIR}/bootstrap.json`, JSON.stringify(bootstrap));
  await writeFile(`${DATA_DIR}/fixtures.json`, JSON.stringify(fixtures));

  const inScope = bootstrap.elements.filter(
    (e) => all || (e.minutes as number) >= MIN_SEASON_MINUTES,
  );
  const ids = inScope.map((e) => e.id as number);
  console.log(
    `${bootstrap.elements.length} players total; ${ids.length} in scope` +
      (all ? " (--all)" : ` (>= ${MIN_SEASON_MINUTES} minutes)`),
  );

  console.log(`Fetching per-match history for ${ids.length} players…`);
  let done = 0;
  const histories: Record<number, unknown[]> = {};
  await mapWithConcurrency(ids, CONCURRENCY, async (id) => {
    try {
      const summary = await fpl<{ history: unknown[] }>(`/element-summary/${id}/`);
      histories[id] = summary.history;
    } catch (err) {
      console.warn(`  skipped ${id}: ${(err as Error).message}`);
    }
    if (++done % 25 === 0 || done === ids.length) {
      process.stdout.write(`  ${done}/${ids.length}\r`);
    }
  });

  await writeFile(`${DATA_DIR}/histories.json`, JSON.stringify(histories));
  console.log(`\nCached ${Object.keys(histories).length} histories to ${DATA_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

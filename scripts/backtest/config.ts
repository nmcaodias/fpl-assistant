import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

/** Where fetch.ts caches raw API responses (gitignored). */
export const DATA_DIR = join(here, "data");

/**
 * A player needs a season's worth of football to be a "relevant" pick and to
 * give the walk-forward enough per-match history to project from. ~900 minutes
 * is roughly ten full matches.
 */
export const MIN_SEASON_MINUTES = 900;

/**
 * The engine can't project a player with almost no history, so a gameweek is
 * only scored once enough of the season has elapsed to form trailing rates.
 */
export const FIRST_SCORED_GW = 6;

/** Horizon (in gameweeks) used for the transfer-decision metric. */
export const TRANSFER_HORIZON = 5;

/** A player-GW only counts toward projection accuracy with this many prior
 * appearances, mirroring the app's own cold-start reluctance. */
export const MIN_PRIOR_APPEARANCES = 3;

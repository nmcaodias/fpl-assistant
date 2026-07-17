# FPL Assistant

A web app that helps you make Fantasy Premier League decisions. Enter your FPL
team ID once and get:

- **My Team** — points, rank, squad value, bank, chips, and your full squad
- **Squad Builder** — the best legal 15 for a budget, for the season launch
  or a wildcard rebuild (no team ID needed)
- **Transfers** — your squad ranked by projected points over the next 5
  gameweeks, with affordable, legal (max 3 per club) upgrades ranked by
  ΔxPts and an explicit "worth a −4 hit" verdict
- **Planner** — a 5-gameweek transfer sequence: when to move, when to hold
  and bank a free transfer, when a hit pays
- **Captaincy** — your squad ranked by next-gameweek xPts, with
  template/differential ownership tags
- **Chips** — when to play each remaining chip (Triple Captain, Bench
  Boost, Free Hit, Wildcard), from your squad's projections across every
  remaining gameweek, doubles and blanks included
- **Fixtures** — a fixture-difficulty grid for the next six gameweeks,
  easiest runs first

## Documentation

- **[How the engine makes decisions](docs/engine.md)** — the projection
  formula, minutes and recency models, calibration, and each decision layer
  (transfers and the hit rule, captaincy, planner, squad builder, chips),
  with the backtest evidence behind every claim and the engine's known
  blind spots.
- **[Making decisions with the app](docs/using-the-app.md)** — the
  manager's workflow: season launch, the weekly routine, how to read the
  numbers and badges, and what to trust versus overrule.

All data comes live from the official FPL API, proxied through `/api/fpl/*`
route handlers (the FPL API blocks browser CORS) with a 5-minute cache.

Decisions come from an expected-points (xPts) engine (`src/lib/projection.ts`)
that projects each player per future gameweek from underlying rates — xG/xA
per 90, projected minutes, Poisson clean-sheet odds, saves,
defensive-contribution points, bonus rate — adjusted per fixture by
difficulty, blended with each player's last five matches where the data can
be afforded, and calibrated onto the scale points are actually scored on.
Backtested walk-forward against last season with no lookahead: transfer
ranking at Spearman 0.414 vs 0.351 for recent form and 0.285 for
points-per-game, with near-exact decile calibration. The full model, the
evidence, and its blind spots: [docs/engine.md](docs/engine.md).

## Finding your team ID

Open fantasy.premierleague.com, go to Points, and copy the number from the
URL: `…/entry/`**`1234567`**`/event/…`

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Backtest

`scripts/backtest/` walk-forward tests the engine against last season. For each
gameweek it rebuilds the engine's inputs from earlier rounds only (no
lookahead), runs the real `projection.ts`, and scores the output against what
actually happened — versus naive baselines (season points-per-game, recent
form) so the numbers are interpretable.

```bash
npm run backtest:fetch      # one-time: cache last season's data (gitignored)
npm run backtest            # walk-forward accuracy + transfer-ranking report
npm run backtest:calibrate  # fit + validate the calibration line
npm run backtest:strategies # planner vs single-swap vs never-transfer, on actuals
npm run backtest:squad      # squad builder vs template squads, on actuals
npm run backtest:ensemble   # do ICT/form blends beat the engine? (no)
```

It measures projection accuracy (per player-gameweek) and transfer-decision
quality (does a high horizon ranking predict actual returns over the next 5
gameweeks). It can't judge the availability model: there's no historical
injury feed, so everyone is assumed available and FPL's own `ep_next` anchor
is switched off — it tests the rate/minutes/fixture/form core.

## Deploy (Vercel)

Push this repo to GitHub, then import it at https://vercel.com/new — no
environment variables or configuration needed. The API routes run as
serverless functions.

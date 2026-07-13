# FPL Assistant

A web app that helps you make Fantasy Premier League decisions. Enter your FPL
team ID once and get:

- **My Team** — points, rank, squad value, bank, chips, and your full squad
- **Transfers** — your squad ranked by projected points over the next 5
  gameweeks, with affordable, legal (max 3 per club) upgrades ranked by
  ΔxPts and an explicit "worth a −4 hit" verdict
- **Captaincy** — your squad ranked by next-gameweek xPts, with
  template/differential ownership tags
- **Chips** — when to play each remaining chip (Triple Captain, Bench
  Boost, Free Hit, Wildcard), from your squad's projections across every
  remaining gameweek, doubles and blanks included
- **Fixtures** — a fixture-difficulty grid for the next six gameweeks,
  easiest runs first

All data comes live from the official FPL API, proxied through `/api/fpl/*`
route handlers (the FPL API blocks browser CORS) with a 5-minute cache.

Decisions come from an expected-points (xPts) engine (`src/lib/projection.ts`)
that projects each player per future gameweek from underlying rates — xG/xA
per 90, projected minutes, Poisson clean-sheet odds from team goals conceded,
saves, defensive-contribution points (2025/26 rule), and bonus rate — adjusted
per fixture by difficulty. Double gameweeks sum both fixtures; blanks score
zero; flagged players are assumed back within ~4 gameweeks. Chip advice
(`src/lib/chips.ts`) sits on top: Triple Captain targets the best
single-player gameweek, Bench Boost the best full-15 gameweek, Free Hit the
worst blank, and the Wildcard is judged by how much xPts a rebuild adds.

## Finding your team ID

Open fantasy.premierleague.com, go to Points, and copy the number from the
URL: `…/entry/`**`1234567`**`/event/…`

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000.

## Deploy (Vercel)

Push this repo to GitHub, then import it at https://vercel.com/new — no
environment variables or configuration needed. The API routes run as
serverless functions.

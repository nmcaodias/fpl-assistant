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
per fixture by difficulty. For the nearest gameweek the projection is anchored
partway to FPL's own `ep_next`. Double gameweeks sum both fixtures; blanks
score zero; flagged players are assumed back within ~4 gameweeks.

Season averages alone understate anyone who arrived or became a starter
mid-season, so the engine layers recency on top in one of two ways:

- **A real recent window**, where we can afford it. `/api/fpl/players?ids=…`
  pulls each player's last 5 matches from `element-summary` and the engine
  blends those rates into the season baseline by sample size (a thin window
  barely moves the season number; five full matches roughly two-thirds
  outweigh it). This costs one upstream request per player, so it's scoped to
  your squad and its upgrade candidates — never the whole market.
- **A form proxy**, for everyone else. A player's `form` relative to their own
  season average, regressed and bounded since it's a small sample.

The two never combine — both describe recency, so applying them together would
double-count. The proxy is also off between seasons, when FPL zeroes every
player's `form`.

Chip advice
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

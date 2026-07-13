# FPL Assistant

A web app that helps you make Fantasy Premier League decisions. Enter your FPL
team ID once and get:

- **My Team** — points, rank, squad value, bank, chips, and your full squad
- **Transfers** — your squad ranked weakest-first, with affordable, legal
  (max 3 per club) upgrade suggestions for each player
- **Captaincy** — your squad ranked for the armband for the next gameweek
- **Fixtures** — a fixture-difficulty grid for the next six gameweeks,
  easiest runs first

All data comes live from the official FPL API, proxied through `/api/fpl/*`
route handlers (the FPL API blocks browser CORS) with a 5-minute cache.

The scoring model is transparent: a weighted blend of points per game, form,
expected points, fixture ease, and value (points per £m), normalized within
position. Components that carry no signal (e.g. form in pre-season, fixtures
between seasons) drop out automatically and the weights renormalize — see
`src/lib/scoring.ts`.

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

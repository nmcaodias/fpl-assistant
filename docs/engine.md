# How the engine makes decisions

Everything the app recommends comes from one number: **projected points
(xPts)** per player per future gameweek. Every page is a different question
asked of the same projection, so this document explains the projection once,
then each decision layer built on it. Numbers quoted as "validated" come from
the walk-forward backtest over 2025/26 (`scripts/backtest/`), which rebuilds
the engine's inputs for each gameweek from earlier rounds only — no lookahead
— and scores against points actually scored.

## 1. The projection, step by step

### Data

Everything comes live from the official FPL API, proxied through
`/api/fpl/*`: season aggregates and per-90 rates for every player
(`bootstrap-static`), the schedule with FPL's fixture difficulty ratings
(`fixtures`), your squad (`entry`), and — for your squad plus the current
transfer shortlist only, since it costs one request per player — each
player's last five matches (`element-summary`).

### Expected points for one match

For a player at full availability against a fixture of difficulty `fdr`
(FPL's 1–5 scale, 3 = neutral), with `m` = expected share of 90 minutes:

| component | formula | notes |
|---|---|---|
| appearance | `clamp(xMins/45) + clamp((xMins−25)/50)` | ≈2 pts for a nailed starter |
| attack | `(xG/90 × goalPts + xA/90 × 3) × m × (1 + (3−fdr) × 0.12)` | goalPts: GK 10, DEF 6, MID 5, FWD 4 |
| clean sheet | `csPts × P(60min) × e^(−λ)` | csPts: GK/DEF 4, MID 1; λ = team goals conceded/match × (1 + (fdr−3) × 0.15), prior 1.3 |
| goals conceded | `−0.5 × λ × m` (GK/DEF only) | the −1 per 2 conceded rule |
| saves | `saves/90 × m ÷ 3` (GK only) | 1 pt per 3 saves |
| defensive contribution | `2 × clamp(1.4 × dcRate/threshold − 0.75, 0, 0.9)` | 2025/26 rule; threshold DEF 10, MID/FWD 12 |
| bonus | season bonus per 90 × `m` | |

A double gameweek sums both fixtures; a blank is exactly 0.

### Expected minutes

Season minutes ÷ team matches played, **blended with the player's last five
matches by sample size**: with `w = recentMinutes / (recentMinutes + 270)`, five
full matches outweigh the season roughly two to one, while one cameo barely
moves it. This is what fixes the engine's oldest bias — a player who became a
starter in March no longer looks like a bench option because of August–February.
The same blend applies to xG/90, xA/90, saves, defensive contributions, and
bonus rate. Recent windows are fetched for your squad and its transfer
candidates; the rest of the market uses season rates. Validated: the blend adds
≈+0.02 Spearman to transfer ranking (0.395 → 0.414).

### Form, for players without a recent window

A regressed multiplier: `clamp(1 + (form/PPG − 1) × 0.5, 0.6, 1.6)` — the
player's recent points-per-game relative to their own season average, moved
halfway and bounded. Applied **only** when no real recent window fed the rates
(both describe recency; using both would double-count), only to fully
available players (injuries are the availability model's job), and never
between seasons (FPL zeroes `form` then, which would floor the whole market).

### Availability

Status `a` = 1.0; `d` = FPL's chance-of-playing (default 75%); injured or
suspended = 0.1. Flagged players recover linearly to full availability over
four gameweeks in the projection — a horizon view must not write off a star
with a knock. Players who left the league never recover.

### Calibration — putting xPts on the true points scale

The raw model ranks well but was over-confident at both ends: over 2025/26 its
top decile of 5-gameweek projections predicted 25.9 points and returned 19.2;
its bottom decile predicted 2.2 and returned 8.0. So every per-gameweek
projection is passed through a straight line fitted walk-forward on last
season (`npm run backtest:calibrate`, re-derive each season):

```
calibrated = 1.115 + 0.523 × raw        (per gameweek; blanks stay 0)
```

The coefficients come from the fit at the **5-gameweek-horizon** level rather
than per-week (slopes 0.523 vs 0.679 — they genuinely differ, because a
player's five weekly projections are near-copies, so bias compounds across the
sum while actual-points noise cancels). The horizon is what transfer decisions
read, and its slope is far more stable across a season (0.517–0.520). A line
can't reorder players, so rankings are untouched; what changes is every
decision that reads an absolute gap. After calibration, predicted deciles
track actuals almost exactly (top: 19.1 predicted vs 19.2 actual).

Two guards: a blank gameweek stays exactly 0, and the intercept — which
represents what a fringe player scrapes together when he does feature — is
withheld from players with no season minutes at all (before that guard, an
unavailable keeper projected 5.6 xPts and hid the obvious transfer).

Finally, the nearest single-fixture gameweek is anchored 35% toward FPL's own
`ep_next`, which reflects late-breaking team news and steadies the early-season
cold start.

### Validated accuracy

| ranking signal | Spearman vs actual 5-GW points |
|---|---|
| **this engine** | **0.414** |
| recent form alone | 0.351 |
| season PPG alone | 0.285 |
| ICT index (recent, per 90) | 0.174 |

Top-vs-bottom decile lift is 2.5× and monotonic. Blending form or ICT into
the engine adds ≤0.003 (`npm run backtest:ensemble`) — the recent-window
xG/xA already carries that information — so no ensemble ships.

## 2. The decision layers

### Transfers (`/transfers`)

For each squad player, candidate replacements are ranked by **horizon xPts**
(the calibrated 5-gameweek sum), filtered to: same position, affordable at
price + bank, not owned, ≤3 per club, ≥45 expected minutes, registered. The
squad lists worst-first — the top of the page is who to sell.

**The hit rule is deliberately strict.** A hit costs 4 points, but the badge
only calls a move hit-worthy above a gain of **10**. Break-even isn't enough,
because the suggestion is the best of hundreds of candidates and the maximum
of many noisy estimates is always flattered by its own luck (the optimizer's
curse — calibration can't fix a bias that only exists in the argmax).
Simulated on last season, taking hits at a 4-point edge lost ~9 points per 5
gameweeks versus never hitting; the loss only vanishes near a threshold of
10–12, by which point hits fire on ~2% of gameweeks. Hits almost never pay.

### Captaincy (`/captaincy`)

Your squad ranked by next-gameweek xPts — the captain doubles it. Ownership
tags frame the risk: ≥25% owned is a template pick (protects rank, the field
has him too); ≤10% is a differential (moves you up when it lands). The engine
ranks pure expectation and leaves the template/differential call to you.

### Planner (`/planner`)

A beam search over the coming five gameweeks. Each state carries squad, bank,
and banked free transfers (cap 5); each week the plan may make 0, 1, or 2
same-position swaps, paying −4 per move beyond the free ones. Weeks are scored
by the best legal starting XI's xPts (all valid formations considered), so
bench upgrades don't count like starter upgrades; swaps gaining under 1.5 xPts
over the remaining horizon are ignored as noise.

Honest label, from measurement: simulated week by week on last season, the
planner **ties** the transfers page's simple best-single-swap advice (±0.3
points over 5 gameweeks, well inside noise). Weekly re-decision erases most of
a lookahead's advantage. Its real use is context — seeing hold-vs-move and
banking decisions laid out — not extra points.

### Squad Builder (`/squad`)

The initial-squad picker, following the integer-programming formulation in the
FPL literature (Ghasemi et al., arXiv:2505.02170), solved by greedy seeds plus
swap search. It maximizes, subject to budget, 2/5/5/3 quotas, and ≤3 per club:

```
XI horizon xPts  +  captain's xPts again  +  0.15 × bench xPts
```

The doubled-captain term is what buys a premium a pure value-per-pound squad
would never take (nobody worth the armband is the classic ROI-squad failure);
the low bench weight is why cheap enablers appear on the bench without any
hard-coded budget split. Validated: on reconstructed last-season windows it
out-scored feasible points-per-pound template squads on actual points in 7 of
7 trials (~110 ms per build).

### Chips (`/chips`)

Each chip window is scanned with the squad projected to season end:

- **Triple Captain** → the gameweek where any one of your players projects
  highest (doubles naturally rise to the top); the extra captaincy is worth
  that player's xPts again.
- **Bench Boost** → the gameweek where all 15 project most, with the bench's
  share shown — if the bench adds little, strengthen it first.
- **Free Hit** → the worst blank (fewest of your squad with a fixture, when
  under 11); if no blank exists yet, hold — blanks appear when cup rounds
  displace fixtures.
- **Wildcard** → recommended when your top available upgrades sum to ≥15 xPts
  over the coming weeks (more than free transfers can deliver); otherwise hold
  for an injury crisis or fixture swing.

## 3. What the engine does not know

- **Transfers in real life**: new signings and newly promoted teams have no
  minutes, so they project near zero until they play. Judge them yourself.
- **Team news beyond FPL's flags** — no press conferences, no rotation models.
- **Prices**: market values, not your personal selling prices; no
  price-change prediction.
- **Effective ownership**: xPts is pure expectation; the captaincy page's
  ownership tags are the only rank-protection signal.
- **Early season**: GW1–3 recent windows are empty (history resets), so the
  engine leans on the form proxy and `ep_next` until matches accumulate.
- The backtest can't judge the availability model (no historical injury feed)
  and runs with `ep_next` off, so validated numbers describe the engine's
  core rather than every live input.

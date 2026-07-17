# Making decisions with the app

How to run an FPL season with this tool, from picking the initial squad to the
last gameweek. The engine behind every number is documented in
[engine.md](engine.md); this is the manager's-eye view.

## Season launch (or a wildcard rebuild)

**Squad Builder** (`/squad`) — deliberately outside the team-ID gate, because
its moment is when you don't have a team yet.

1. Set your budget (£100.0m at launch) and read the squad it proposes: a
   formation-legal XI with a captain, and a cheap bench that emerged from the
   optimization rather than a rule.
2. Treat it as a **strong first draft, not an order form**. The engine only
   knows played football: a marquee summer signing or a promoted team's star
   projects near zero until they get Premier League minutes. Swap those in by
   your own judgment where the draft has a weak slot.
3. Sanity-check the captain premium. The squad carries at least one expensive
   player *because* the armband doubles him — if you'd never captain him,
   pick a different premium, not a cheaper mid-tier spread.

The same page is the wildcard tool in-season: set budget to squad value +
bank and compare its 15 against yours.

## The weekly routine

Order matters less than people think, but this sequence reads naturally:

1. **My Team** (`/`) — sanity check: injuries/flags on your squad, last
   gameweek's result, bank.
2. **Transfers** (`/transfers`) — the squad listed worst-first. Open the top
   row and look at the candidates' Δ xPts over the next five gameweeks.
   - Gains under ~2 xPts are inside the model's noise — banking the free
     transfer is a real option, not a failure to act.
   - **Take the "worth a hit" badge literally, including its absence.** It
     fires above +10 xPts, far beyond the 4 points a hit costs, because
     backtesting showed smaller edges lose points on average (see
     engine.md). No badge = don't hit, even if the raw arithmetic looks
     tempting.
3. **Planner** (`/planner`) — context for the *sequence*: whether to hold and
   bank a transfer, make the move now, or split two moves across two weeks.
   Measured honestly, following the planner scores about the same as taking
   the best single swap each week — use it to see the timing trade-offs, not
   as a stronger oracle.
4. **Captaincy** (`/captaincy`) — ranked by next-gameweek xPts, captain
   doubles it. The template/differential tags are the risk dial: chasing rank
   from behind favors a low-owned pick; protecting a lead favors the
   template. The xPts gap between rows tells you what the safety costs.
5. **Chips** (`/chips`) — glance weekly, act rarely. Recommendations firm up
   as fixtures (and cup reschedules) are confirmed; re-check after every cup
   round for new blanks and doubles.
6. **Fixtures** (`/fixtures`) — the difficulty grid, easiest runs first, for
   eyeballing which teams' assets to target over the next month.

## Reading the numbers

- **xPts** is calibrated to the real scoring scale: ~4+ per gameweek is a
  strong starter, ~6+ is elite captaincy territory. Sums are over the page's
  horizon (usually 5 gameweeks).
- **`(last 5)`** after a minutes figure means real recent-match data fed that
  projection (squad and shortlist players); others run on season rates.
- **Form badge** (▲/▼ %) — the player is running above/below their own season
  baseline and the projection was adjusted; shown only when it deviates
  enough to matter.
- **Status badges** — FPL's availability flags; a doubtful player's
  projection is already scaled by his chance of playing and assumed back to
  full fitness within ~4 gameweeks.
- **Prices are market values**, not your selling prices — check your actual
  proceeds in the official app before committing a plan that depends on the
  cash.
- Our xPts will differ from FPL's own `ep_next`: ours is a 5-week horizon
  model with its own minutes/fixture logic (the nearest week is partly
  anchored to FPL's number on purpose).

## Between seasons

Fixture-driven advice (planner, chips timing, fixture grid) sleeps until the
new season's fixtures land in the API; rankings fall back to full-season
rates, clearly bannered. The Squad Builder still works — that's the point:
build your launch squad in pre-season, then re-check it as signings get
minutes in pre-season friendlies (which the API doesn't cover) and as prices
move.

## What to trust, in one paragraph

The engine's edge is **ranking** — who is better to own over the next month —
validated at Spearman 0.414 vs 0.35 for naive form. Trust the order more than
any single number; trust gaps under ~2 xPts not at all; almost never pay for
transfers (the −4 badge encodes the evidence); and overrule the model freely
on the things it cannot see: new signings, rotation news, and your own risk
position in your mini-league.

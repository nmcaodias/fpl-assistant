import { describe, expect, it } from "vitest";
import { bestXiEp, planTransfers, type PlannerOptions } from "./planner";
import type { PlayerProjection, ProjectionContext } from "./projection";
import type { Position } from "./types";
import { makePlayer } from "./test-factories";

/** Projection stub with explicit per-week eps (gw 1 = week 0). */
function proj(
  id: number,
  pos: Position,
  cost: number,
  eps: number[],
  overrides: Partial<ReturnType<typeof makePlayer>> = {},
): PlayerProjection {
  return {
    player: makePlayer({ id, element_type: pos, now_cost: cost, minutes: 900, ...overrides }),
    xMins: 90,
    epPerMatch: eps[0] ?? 0,
    form: 1,
    usedRecent: false,
    perGw: eps.map((ep, i) => ({ gw: i + 1, ep, fixtures: [] })),
    horizonEp: eps.reduce((s, e) => s + e, 0),
  };
}

function ctxFor(weeks: number): ProjectionContext {
  return {
    nextGw: 1,
    lastGw: weeks,
    upcomingByTeam: {},
    concededPerMatch: {},
    gamesPlayed: {},
    seasonFinished: false,
  };
}

/**
 * A full 15-man squad (2 GK, 5 DEF, 5 MID, 3 FWD) of ids 1–15 on distinct
 * teams, every week's ep = 1 — quiet filler that specific test players
 * replace via `swap`.
 */
function fillerSquad(weeks: number): Map<number, PlayerProjection> {
  const positions: Position[] = [1, 1, 2, 2, 2, 2, 2, 3, 3, 3, 3, 3, 4, 4, 4];
  const market = new Map<number, PlayerProjection>();
  positions.forEach((pos, i) => {
    const id = i + 1;
    market.set(id, proj(id, pos, 40, Array(weeks).fill(1), { team: id }));
  });
  return market;
}

const squadIds = () => Array.from({ length: 15 }, (_, i) => i + 1);

const options = (over: Partial<PlannerOptions> = {}): PlannerOptions => ({
  freeTransfers: 1,
  bankTenths: 0,
  weeks: 3,
  ...over,
});

describe("bestXiEp", () => {
  it("picks the highest-scoring legal formation", () => {
    const market = fillerSquad(1);
    // Make all five DEF worth 5 — a 5-4-1 (or 5-3-2) should be chosen.
    for (const id of [3, 4, 5, 6, 7]) market.set(id, proj(id, 2, 40, [5], { team: id }));
    const squad = [...market.values()];
    // 1 GK (1) + 5 DEF (25) + 4 MID + 1 FWD fillers (5×1) = 31.
    expect(bestXiEp(squad, (p) => p.perGw[0].ep)).toBe(31);
  });

  it("never fields more than one goalkeeper", () => {
    const market = fillerSquad(1);
    market.set(1, proj(1, 1, 40, [9], { team: 1 }));
    market.set(2, proj(2, 1, 40, [9], { team: 2 }));
    const squad = [...market.values()];
    // One 9-point GK + 10 filler outfielders, not both GKs.
    expect(bestXiEp(squad, (p) => p.perGw[0].ep)).toBe(19);
  });
});

describe("planTransfers", () => {
  it("returns null between seasons", () => {
    const market = fillerSquad(3);
    const ctx = { ...ctxFor(3), nextGw: null, seasonFinished: true };
    expect(planTransfers(squadIds(), market, ctx, options())).toBeNull();
  });

  it("stands pat when no move clears the noise threshold, banking free transfers", () => {
    const market = fillerSquad(3);
    // A marginal upgrade (+0.3/week) that should be ignored.
    market.set(100, proj(100, 3, 40, [1.3, 1.3, 1.3], { team: 100 }));
    const plan = planTransfers(squadIds(), market, ctxFor(3), options())!;

    expect(plan.weeks.every((w) => w.moves.length === 0)).toBe(true);
    expect(plan.gain).toBe(0);
    // 1 FT at week one, banking up each idle week.
    expect(plan.weeks.map((w) => w.freeTransfers)).toEqual([1, 2, 3]);
  });

  it("makes an obvious upgrade immediately", () => {
    const market = fillerSquad(3);
    market.set(100, proj(100, 3, 40, [4, 4, 4], { team: 100 }));
    const plan = planTransfers(squadIds(), market, ctxFor(3), options())!;

    expect(plan.weeks[0].moves).toHaveLength(1);
    expect(plan.weeks[0].moves[0].in.player.id).toBe(100);
    expect(plan.weeks[0].hitCost).toBe(0);
    // Nine weeks of +3 over filler... 3 weeks × 3 = 9 gained.
    expect(plan.gain).toBeCloseTo(9, 0);
  });

  it("waits to sell a player whose big week comes first", () => {
    const market = fillerSquad(3);
    // Squad midfielder: 6 now, nothing after. Candidate: steady 4s. Prices
    // force the candidate onto this exact slot — no filler sale affords him —
    // so the only question is when to pull the trigger.
    market.set(8, proj(8, 3, 100, [6, 0, 0], { team: 8 }));
    market.set(100, proj(100, 3, 100, [4, 4, 4], { team: 100 }));
    const plan = planTransfers(squadIds(), market, ctxFor(3), options())!;

    const moveWeek = plan.weeks.findIndex((w) =>
      w.moves.some((m) => m.in.player.id === 100),
    );
    // Selling at week 0 forfeits the 6-point week; the plan should hold, then swap.
    expect(moveWeek).toBe(1);
    expect(plan.weeks[1].hitCost).toBe(0);
  });

  it("takes a −4 hit when a double gameweek pays for it, not for marginal gains", () => {
    const paysMarket = fillerSquad(3);
    // Two candidates whose value is front-loaded (a DGW next week): waiting a
    // week forfeits most of the gain, so the second move is worth a hit.
    paysMarket.set(100, proj(100, 3, 40, [9, 1, 1], { team: 100 }));
    paysMarket.set(101, proj(101, 4, 40, [9, 1, 1], { team: 101 }));
    const pays = planTransfers(squadIds(), paysMarket, ctxFor(3), options())!;
    expect(pays.weeks[0].moves).toHaveLength(2);
    expect(pays.weeks[0].hitCost).toBe(4);
    expect(pays.totalHitCost).toBe(4);

    const marginalMarket = fillerSquad(3);
    // Steady candidates: the second move loses nothing by waiting a week, so
    // a hit would burn 4 points for no reason.
    marginalMarket.set(100, proj(100, 3, 40, [3, 3, 3], { team: 100 }));
    marginalMarket.set(101, proj(101, 4, 40, [3, 3, 3], { team: 101 }));
    const patient = planTransfers(squadIds(), marginalMarket, ctxFor(3), options())!;
    expect(patient.totalHitCost).toBe(0);
    // Both upgrades still happen — one per week on free transfers.
    const boughtIds = patient.weeks.flatMap((w) => w.moves.map((m) => m.in.player.id));
    expect(boughtIds.sort()).toEqual([100, 101]);
  });

  it("never schedules paid transfers when hits are disallowed", () => {
    const market = fillerSquad(3);
    market.set(100, proj(100, 3, 40, [9, 1, 1], { team: 100 }));
    market.set(101, proj(101, 4, 40, [9, 1, 1], { team: 101 }));
    const plan = planTransfers(squadIds(), market, ctxFor(3), options({ allowHits: false }))!;

    expect(plan.totalHitCost).toBe(0);
    for (const w of plan.weeks) expect(w.moves.length).toBeLessThanOrEqual(w.freeTransfers);
  });

  it("banks a free transfer to afford a double move without a hit", () => {
    const market = fillerSquad(3);
    // Both candidates explode in week 2 (gw 3) — the plan should idle week
    // one (banking a second FT), then make both moves free.
    market.set(100, proj(100, 3, 40, [1, 1, 9], { team: 100 }));
    market.set(101, proj(101, 4, 40, [1, 1, 9], { team: 101 }));
    const plan = planTransfers(squadIds(), market, ctxFor(3), options())!;

    expect(plan.totalHitCost).toBe(0);
    const boughtIds = plan.weeks.flatMap((w) => w.moves.map((m) => m.in.player.id));
    expect(boughtIds.sort()).toEqual([100, 101]);
  });

  it("chains budget: an early downgrade funds a later marquee buy", () => {
    const market = fillerSquad(3);
    // A: overpriced filler-level midfielder. B: sidegrade 20 cheaper (small
    // real gain). D: marquee forward, unaffordable until A→B frees the cash.
    market.set(8, proj(8, 3, 100, [1, 1, 1], { team: 8 }));
    market.set(100, proj(100, 3, 80, [2, 2, 2], { team: 100 }));
    market.set(101, proj(101, 4, 60, [8, 8, 8], { team: 101 }));
    // Squad FWD slot 13 costs 40; 40 + bank 0 < 60 — blocked until the sale.
    const plan = planTransfers(squadIds(), market, ctxFor(3), options())!;

    const bought = plan.weeks.flatMap((w) => w.moves.map((m) => m.in.player.id));
    expect(bought).toContain(101);
    const weekOf = (id: number) =>
      plan.weeks.findIndex((w) => w.moves.some((m) => m.in.player.id === id));
    // The funding sale must come before (or with) the marquee buy.
    expect(weekOf(100)).toBeLessThanOrEqual(weekOf(101));
    expect(plan.weeks[weekOf(101)].bankAfter).toBeGreaterThanOrEqual(0);
  });

  it("respects the three-per-club cap, counting the outgoing player's slot", () => {
    const market = fillerSquad(3);
    // Three squad players already belong to team 99…
    for (const id of [3, 4, 5]) {
      const existing = market.get(id)!;
      market.set(id, proj(id, 2, 40, [1, 1, 1], { team: 99, web_name: existing.player.web_name }));
    }
    // …and the best candidate is also from team 99.
    market.set(100, proj(100, 3, 40, [6, 6, 6], { team: 99 }));
    const blocked = planTransfers(squadIds(), market, ctxFor(3), options())!;
    expect(
      blocked.weeks.flatMap((w) => w.moves.map((m) => m.in.player.id)),
    ).not.toContain(100);

    // Selling one of the three team-99 players makes room.
    market.set(100, proj(100, 2, 40, [6, 6, 6], { team: 99 }));
    const allowed = planTransfers(squadIds(), market, ctxFor(3), options())!;
    const move = allowed.weeks
      .flatMap((w) => w.moves)
      .find((m) => m.in.player.id === 100);
    expect(move).toBeDefined();
    expect(move!.out.player.team).toBe(99);
  });

  it("never buys above bank + selling price", () => {
    const market = fillerSquad(3);
    market.set(100, proj(100, 3, 90, [9, 9, 9], { team: 100 }));
    const broke = planTransfers(squadIds(), market, ctxFor(3), options({ bankTenths: 0 }))!;
    expect(
      broke.weeks.flatMap((w) => w.moves.map((m) => m.in.player.id)),
    ).not.toContain(100);

    const funded = planTransfers(squadIds(), market, ctxFor(3), options({ bankTenths: 50 }))!;
    expect(
      funded.weeks.flatMap((w) => w.moves.map((m) => m.in.player.id)),
    ).toContain(100);
  });
});

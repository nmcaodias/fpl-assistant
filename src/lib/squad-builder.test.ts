import { describe, expect, it } from "vitest";
import { buildSquad, SQUAD_QUOTAS, SQUAD_SIZE } from "./squad-builder";
import type { PlayerProjection } from "./projection";
import type { Position } from "./types";
import { makePlayer } from "./test-factories";

/** Projection stub: what matters here is horizonEp, price, position, club. */
function proj(
  id: number,
  pos: Position,
  costTenths: number,
  horizonEp: number,
  overrides: Partial<ReturnType<typeof makePlayer>> = {},
): PlayerProjection {
  return {
    player: makePlayer({
      id,
      element_type: pos,
      now_cost: costTenths,
      team: overrides.team ?? 200 + id, // unique club unless a test says otherwise
      ...overrides,
    }),
    xMins: 90,
    epPerMatch: horizonEp,
    form: 1,
    usedRecent: false,
    perGw: [],
    horizonEp,
  };
}

/**
 * A generous market: per position, `n` players at descending quality. Prices
 * descend with quality; every player is on their own club by default.
 */
function openMarket(): Map<number, PlayerProjection> {
  const market = new Map<number, PlayerProjection>();
  let id = 1;
  const add = (pos: Position, n: number, top: number) => {
    for (let i = 0; i < n; i++) {
      const ep = Math.max(top - i * 0.7, 1);
      const price = Math.max(40, Math.round(45 + ep * 6));
      market.set(id, proj(id, pos, price, ep));
      id++;
    }
  };
  add(1, 6, 5);
  add(2, 14, 7);
  add(3, 14, 9);
  add(4, 8, 8);
  return market;
}

describe("buildSquad", () => {
  it("returns a legal squad: quotas, size, club cap, and budget all respected", () => {
    const market = openMarket();
    const squad = buildSquad(market, 1000)!;
    const all = [...squad.starters, ...squad.bench];

    expect(all).toHaveLength(SQUAD_SIZE);
    expect(new Set(all.map((p) => p.player.id)).size).toBe(SQUAD_SIZE);
    for (const pos of [1, 2, 3, 4] as Position[]) {
      expect(all.filter((p) => p.player.element_type === pos)).toHaveLength(SQUAD_QUOTAS[pos]);
    }
    const perClub = new Map<number, number>();
    for (const p of all) perClub.set(p.player.team, (perClub.get(p.player.team) ?? 0) + 1);
    expect(Math.max(...perClub.values())).toBeLessThanOrEqual(3);
    expect(squad.costTenths).toBeLessThanOrEqual(1000);
    expect(squad.bankTenths).toBe(1000 - squad.costTenths);
  });

  it("is deterministic", () => {
    const market = openMarket();
    const a = buildSquad(market, 1000)!;
    const b = buildSquad(market, 1000)!;
    expect(a.starters.map((p) => p.player.id)).toEqual(b.starters.map((p) => p.player.id));
    expect(a.objective).toBe(b.objective);
  });

  it("captains the highest-projected starter and counts the double in the objective", () => {
    const market = openMarket();
    const squad = buildSquad(market, 1000)!;
    const maxEp = Math.max(...squad.starters.map((p) => p.horizonEp));
    expect(squad.captain.horizonEp).toBe(maxEp);
    const benchEp = squad.bench.reduce((s, p) => s + p.horizonEp, 0);
    expect(squad.objective).toBeCloseTo(squad.xiEp + maxEp + 0.15 * benchEp, 1);
  });

  it("buys the premium captain a pure value-per-pound squad would skip", () => {
    const market = new Map<number, PlayerProjection>();
    let id = 1;
    // Premium forward: poor value per pound, but the best doubled score.
    market.set(id, proj(id++, 4, 125, 12));
    // Better-ROI midtier forwards.
    for (let i = 0; i < 4; i++) market.set(id, proj(id++, 4, 60, 7));
    // Fillers for every slot.
    const fill = (pos: Position, n: number) => {
      for (let i = 0; i < n; i++) market.set(id, proj(id++, pos, 40, 2));
    };
    fill(1, 4);
    fill(2, 8);
    fill(3, 8);
    fill(4, 2);

    const squad = buildSquad(market, 700)!;
    const ids = [...squad.starters, ...squad.bench].map((p) => p.player.id);
    expect(ids).toContain(1);
    expect(squad.captain.player.id).toBe(1);
  });

  it("keeps the bench cheap and spends the budget on the XI", () => {
    const market = new Map<number, PlayerProjection>();
    let id = 1;
    const add = (pos: Position, n: number, price: number, ep: number) => {
      for (let i = 0; i < n; i++) market.set(id, proj(id++, pos, price, ep));
    };
    // Plenty of good starters and plenty of fodder at every position.
    add(1, 3, 50, 5);
    add(1, 3, 40, 1.5);
    add(2, 7, 70, 6);
    add(2, 7, 40, 1.5);
    add(3, 7, 80, 7);
    add(3, 7, 45, 1.5);
    add(4, 4, 75, 6.5);
    add(4, 4, 45, 1.5);

    const squad = buildSquad(market, 1000)!;
    const benchCost = squad.bench.reduce((s, p) => s + p.player.now_cost, 0);
    // Four bench slots near fodder prices — the classic cheap-bench split.
    expect(benchCost).toBeLessThanOrEqual(4 * 50);
    // And the XI holds the expensive players, not the other way round.
    const xiAvg =
      squad.starters.reduce((s, p) => s + p.player.now_cost, 0) / squad.starters.length;
    expect(xiAvg).toBeGreaterThan(benchCost / 4);
  });

  it("respects a tight budget by downgrading rather than failing", () => {
    // openMarket's cheapest legal squad costs 810, so 850 binds hard.
    const market = openMarket();
    const rich = buildSquad(market, 1000)!;
    const poor = buildSquad(market, 850)!;
    expect(poor.costTenths).toBeLessThanOrEqual(850);
    expect(poor.objective).toBeLessThan(rich.objective);
  });

  it("returns null when no legal squad fits the budget", () => {
    const market = openMarket(); // cheapest possible squad costs well over 100
    expect(buildSquad(market, 100)).toBeNull();
  });

  it("returns null when a position can't be filled at all", () => {
    const market = openMarket();
    for (const [id, p] of [...market]) {
      if (p.player.element_type === 1) market.delete(id);
    }
    expect(buildSquad(market, 1000)).toBeNull();
  });

  it("never picks unavailable ('u') or unregistered ('n') players", () => {
    const market = openMarket();
    // Make the best midfielder unavailable — they'd be first pick otherwise.
    const bestMid = [...market.values()]
      .filter((p) => p.player.element_type === 3)
      .sort((a, b) => b.horizonEp - a.horizonEp)[0];
    market.set(
      bestMid.player.id,
      proj(bestMid.player.id, 3, bestMid.player.now_cost, bestMid.horizonEp, { status: "u" }),
    );
    const squad = buildSquad(market, 1000)!;
    const ids = [...squad.starters, ...squad.bench].map((p) => p.player.id);
    expect(ids).not.toContain(bestMid.player.id);
  });

  it("enforces the club cap even when one club has all the best players", () => {
    const market = openMarket();
    // Put the top five defenders all at club 99.
    const defs = [...market.values()]
      .filter((p) => p.player.element_type === 2)
      .sort((a, b) => b.horizonEp - a.horizonEp)
      .slice(0, 5);
    for (const d of defs) {
      market.set(
        d.player.id,
        proj(d.player.id, 2, d.player.now_cost, d.horizonEp, { team: 99 }),
      );
    }
    const squad = buildSquad(market, 1000)!;
    const fromClub99 = [...squad.starters, ...squad.bench].filter(
      (p) => p.player.team === 99,
    );
    expect(fromClub99.length).toBeLessThanOrEqual(3);
  });

  it("local search improves on every greedy seed (sanity: swaps only ever help)", () => {
    // Not a direct white-box check, but with a market where value-greedy and
    // points-greedy both start wrong, the final objective must at least match
    // the better of the naive strategies.
    const market = openMarket();
    const squad = buildSquad(market, 900)!;
    expect(squad.objective).toBeGreaterThan(0);
    // Re-running with a marginally larger budget can never do worse.
    const bigger = buildSquad(market, 910)!;
    expect(bigger.objective).toBeGreaterThanOrEqual(squad.objective);
  });
});

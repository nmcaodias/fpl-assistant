import { describe, expect, it } from "vitest";
import { adviseChips, CHIP_LABELS } from "./chips";
import type { GwProjection, PlayerProjection } from "./projection";
import { makePlayer } from "./test-factories";
import type { ChipDef } from "./types";

function makeProjection(
  id: number,
  epByGw: Record<number, number | { ep: number; fixtures: number }>,
): PlayerProjection {
  const perGw: GwProjection[] = Object.entries(epByGw).map(([gw, v]) => {
    const ep = typeof v === "number" ? v : v.ep;
    const fixtureCount = typeof v === "number" ? 1 : v.fixtures;
    return {
      gw: Number(gw),
      ep,
      fixtures: Array.from({ length: fixtureCount }, (_, i) => ({
        event: Number(gw),
        opponent: 900 + i,
        isHome: true,
        difficulty: 3,
      })),
    };
  });
  return {
    player: makePlayer({ id, web_name: `P${id}` }),
    xMins: 90,
    epPerMatch: 5,
    perGw,
    horizonEp: perGw.reduce((s, g) => s + g.ep, 0),
  };
}

function chipDef(name: string, start_event: number, stop_event: number): ChipDef {
  return { id: 1, name, start_event, stop_event, number: 1 };
}

const baseCtx = { nextGw: 5, lastGw: 38 } as never;

describe("adviseChips", () => {
  it("only advises on chips recognized in CHIP_LABELS", () => {
    const advice = adviseChips({
      chipDefs: [chipDef("unknown-chip", 1, 38), chipDef("wildcard", 1, 38)],
      chipsUsed: [],
      squad: [],
      ctx: baseCtx,
      wildcardGain: 0,
    });
    expect(advice).toHaveLength(1);
    expect(advice[0].def.name).toBe("wildcard");
  });

  it("marks a chip as used when it was played within its window", () => {
    const advice = adviseChips({
      chipDefs: [chipDef("3xc", 1, 19)],
      chipsUsed: [{ name: "3xc", event: 10 }],
      squad: [],
      ctx: baseCtx,
      wildcardGain: 0,
    })[0];
    expect(advice.status).toBe("used");
    expect(advice.usedAtGw).toBe(10);
    expect(advice.reason).toBe("Played in GW10.");
  });

  it("does not count a chip use from a different window as 'used'", () => {
    // Played in the first wildcard window; the second-window instance should
    // still be assessed as open/expired based on the current GW.
    const advice = adviseChips({
      chipDefs: [chipDef("wildcard", 20, 38)],
      chipsUsed: [{ name: "wildcard", event: 5 }],
      squad: [],
      ctx: { nextGw: 25, lastGw: 38 } as never,
      wildcardGain: 0,
    })[0];
    expect(advice.status).not.toBe("used");
  });

  it("marks a chip as expired once its window has closed unused", () => {
    const advice = adviseChips({
      chipDefs: [chipDef("bboost", 1, 4)],
      chipsUsed: [],
      squad: [],
      ctx: { nextGw: 5, lastGw: 38 } as never,
      wildcardGain: 0,
    })[0];
    expect(advice.status).toBe("expired");
    expect(advice.reason).toContain("GW1–4");
  });

  it("marks every chip as expired once the season itself is over", () => {
    const advice = adviseChips({
      chipDefs: [chipDef("bboost", 30, 38)],
      chipsUsed: [],
      squad: [],
      ctx: { nextGw: null, lastGw: 38 } as never,
      wildcardGain: 0,
    })[0];
    expect(advice.status).toBe("expired");
  });

  it("marks a chip as upcoming when its window hasn't opened yet", () => {
    const advice = adviseChips({
      chipDefs: [chipDef("freehit", 20, 38)],
      chipsUsed: [],
      squad: [],
      ctx: { nextGw: 5, lastGw: 38 } as never,
      wildcardGain: 0,
    })[0];
    expect(advice.status).toBe("upcoming");
  });

  it("falls back to a generic message for a chip with no recommendation logic", () => {
    const advice = adviseChips({
      chipDefs: [chipDef("manager", 1, 38)],
      chipsUsed: [],
      squad: [],
      ctx: baseCtx,
      wildcardGain: 0,
    })[0];
    expect(advice.status).toBe("open");
    expect(advice.reason).toBe("No recommendation logic for this chip yet.");
    expect(advice.label).toBe(CHIP_LABELS.manager);
  });

  describe("triple captain (3xc)", () => {
    it("recommends the gameweek with the single highest-projected player", () => {
      const squad = [makeProjection(1, { 5: 4, 6: 9 }), makeProjection(2, { 5: 3, 6: 2 })];
      const advice = adviseChips({
        chipDefs: [chipDef("3xc", 1, 38)],
        chipsUsed: [],
        squad,
        ctx: baseCtx,
        wildcardGain: 0,
      })[0];
      expect(advice.recommendedGw).toBe(6);
      expect(advice.reason).toContain("P1");
      expect(advice.reason).toContain("9");
    });

    it("flags a double gameweek in the reason", () => {
      const squad = [makeProjection(1, { 5: { ep: 12, fixtures: 2 } })];
      const advice = adviseChips({
        chipDefs: [chipDef("3xc", 1, 38)],
        chipsUsed: [],
        squad,
        ctx: baseCtx,
        wildcardGain: 0,
      })[0];
      expect(advice.reason).toContain("double gameweek");
    });

    it("says there's nothing to recommend when all projections are zero", () => {
      const squad = [makeProjection(1, {})];
      const advice = adviseChips({
        chipDefs: [chipDef("3xc", 1, 38)],
        chipsUsed: [],
        squad,
        ctx: baseCtx,
        wildcardGain: 0,
      })[0];
      expect(advice.recommendedGw).toBeUndefined();
      expect(advice.reason).toBe("No projected returns in this window yet.");
    });
  });

  describe("bench boost (bboost)", () => {
    it("recommends the gameweek where the full 15 project the most points", () => {
      const squad = [
        makeProjection(1, { 5: 5, 6: 2 }),
        makeProjection(2, { 5: 5, 6: 2 }),
        makeProjection(3, { 5: 1, 6: 8 }),
      ];
      const advice = adviseChips({
        chipDefs: [chipDef("bboost", 1, 38)],
        chipsUsed: [],
        squad,
        ctx: baseCtx,
        wildcardGain: 0,
      })[0];
      // GW5 total = 11, GW6 total = 12
      expect(advice.recommendedGw).toBe(6);
    });
  });

  describe("free hit (freehit)", () => {
    it("recommends the blank gameweek where fewest squad players have a fixture", () => {
      const squad = Array.from({ length: 15 }, (_, i) =>
        makeProjection(i + 1, i < 8 ? { 5: 3 } : {}),
      );
      const advice = adviseChips({
        // Window closes at GW5 so it's the only gameweek considered.
        chipDefs: [chipDef("freehit", 1, 5)],
        chipsUsed: [],
        squad,
        ctx: baseCtx,
        wildcardGain: 0,
      })[0];
      expect(advice.recommendedGw).toBe(5);
      expect(advice.reason).toContain("only 8 of your squad");
    });

    it("holds when no gameweek in the window blanks", () => {
      const squad = Array.from({ length: 15 }, (_, i) => makeProjection(i + 1, { 5: 3 }));
      const advice = adviseChips({
        chipDefs: [chipDef("freehit", 1, 5)],
        chipsUsed: [],
        squad,
        ctx: baseCtx,
        wildcardGain: 0,
      })[0];
      expect(advice.recommendedGw).toBeUndefined();
      expect(advice.reason).toContain("No blank gameweek");
    });
  });

  describe("wildcard", () => {
    it("recommends wildcarding now when available upgrades add at least 15 xPts", () => {
      const advice = adviseChips({
        chipDefs: [chipDef("wildcard", 1, 38)],
        chipsUsed: [],
        squad: [],
        ctx: baseCtx,
        wildcardGain: 15,
      })[0];
      expect(advice.recommendedGw).toBe(5);
      expect(advice.reason).toContain("Consider wildcarding now");
    });

    it("recommends holding when available upgrades add less than 15 xPts", () => {
      const advice = adviseChips({
        chipDefs: [chipDef("wildcard", 1, 38)],
        chipsUsed: [],
        squad: [],
        ctx: baseCtx,
        wildcardGain: 14.9,
      })[0];
      expect(advice.recommendedGw).toBeUndefined();
      expect(advice.reason).toContain("Hold");
    });
  });
});

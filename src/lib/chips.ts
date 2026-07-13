// Chip strategy advisor.
//
// Works the way strong managers plan chips: Triple Captain goes to the best
// single-player gameweek (doubles favored), Bench Boost to the gameweek where
// all 15 players score most (deep doubles), Free Hit covers the worst blank,
// and the Wildcard is judged by how much total xPts a rebuild would add.

import type { PlayerProjection, ProjectionContext } from "./projection";
import type { ChipDef } from "./types";

export const CHIP_LABELS: Record<string, string> = {
  wildcard: "Wildcard",
  freehit: "Free Hit",
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
  manager: "Assistant Manager",
};

export type ChipStatus = "used" | "expired" | "open" | "upcoming";

export interface ChipAdvice {
  def: ChipDef;
  label: string;
  status: ChipStatus;
  usedAtGw?: number;
  recommendedGw?: number;
  reason: string;
}

/** Sum of a squad's xPts for one GW; `topN` limits to the best N players (XI). */
function squadEpAt(squad: PlayerProjection[], gw: number, topN?: number): number {
  const eps = squad
    .map((s) => s.perGw.find((g) => g.gw === gw)?.ep ?? 0)
    .sort((a, b) => b - a);
  const take = topN ? eps.slice(0, topN) : eps;
  return take.reduce((s, e) => s + e, 0);
}

function playersWithFixture(squad: PlayerProjection[], gw: number): number {
  return squad.filter((s) => (s.perGw.find((g) => g.gw === gw)?.fixtures.length ?? 0) > 0)
    .length;
}

function doublersAt(squad: PlayerProjection[], gw: number): number {
  return squad.filter((s) => (s.perGw.find((g) => g.gw === gw)?.fixtures.length ?? 0) >= 2)
    .length;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

export function adviseChips(opts: {
  chipDefs: ChipDef[];
  chipsUsed: { name: string; event: number }[];
  /** Full squad (15) projected to the end of the season */
  squad: PlayerProjection[];
  ctx: ProjectionContext;
  /** Total xPts the top available transfer upgrades would add over ~5 GWs */
  wildcardGain: number;
}): ChipAdvice[] {
  const { chipDefs, chipsUsed, squad, ctx, wildcardGain } = opts;
  const nextGw = ctx.nextGw;

  return chipDefs
    .filter((def) => def.name in CHIP_LABELS)
    .map((def) => {
      const label = CHIP_LABELS[def.name];
      const used = chipsUsed.find(
        (c) => c.name === def.name && c.event >= def.start_event && c.event <= def.stop_event,
      );
      if (used) {
        return {
          def,
          label,
          status: "used" as const,
          usedAtGw: used.event,
          reason: `Played in GW${used.event}.`,
        };
      }
      if (nextGw === null || nextGw > def.stop_event) {
        return {
          def,
          label,
          status: "expired" as const,
          reason: `Window (GW${def.start_event}–${def.stop_event}) has closed unused.`,
        };
      }

      const status: ChipStatus = nextGw < def.start_event ? "upcoming" : "open";
      const from = Math.max(def.start_event, nextGw);
      const gws: number[] = [];
      for (let g = from; g <= Math.min(def.stop_event, ctx.lastGw); g++) gws.push(g);

      return { def, label, status, ...recommend(def.name, gws, squad, wildcardGain, def) };
    });
}

function recommend(
  chip: string,
  gws: number[],
  squad: PlayerProjection[],
  wildcardGain: number,
  def: ChipDef,
): { recommendedGw?: number; reason: string } {
  if (gws.length === 0) return { reason: "No gameweeks left in this window." };

  if (chip === "3xc") {
    let best = { gw: gws[0], ep: -1, name: "" };
    for (const gw of gws) {
      for (const s of squad) {
        const g = s.perGw.find((x) => x.gw === gw);
        if (g && g.ep > best.ep) best = { gw, ep: g.ep, name: s.player.web_name };
      }
    }
    if (best.ep <= 0) return { reason: "No projected returns in this window yet." };
    const doubles = squad.some(
      (s) => (s.perGw.find((x) => x.gw === best.gw)?.fixtures.length ?? 0) >= 2,
    );
    return {
      recommendedGw: best.gw,
      reason: `${best.name} projects ${r1(best.ep)} xPts in GW${best.gw}${
        doubles ? " (double gameweek)" : ""
      } — an extra ${r1(best.ep)} points as triple captain.`,
    };
  }

  if (chip === "bboost") {
    let best = { gw: gws[0], ep: -1 };
    for (const gw of gws) {
      const ep = squadEpAt(squad, gw);
      if (ep > best.ep) best = { gw, ep };
    }
    const bench = r1(best.ep - squadEpAt(squad, best.gw, 11));
    const doubles = doublersAt(squad, best.gw);
    return {
      recommendedGw: best.gw,
      reason: `Your 15 project ${r1(best.ep)} xPts in GW${best.gw}${
        doubles > 0 ? ` (${doubles} players double)` : ""
      }; the bench adds ~${bench}. Best when your bench players all have fixtures — strengthen the bench first if that number is low.`,
    };
  }

  if (chip === "freehit") {
    let worst = { gw: gws[0], count: 16 };
    for (const gw of gws) {
      const count = playersWithFixture(squad, gw);
      if (count < worst.count) worst = { gw, count };
    }
    if (worst.count < 11) {
      return {
        recommendedGw: worst.gw,
        reason: `Blank gameweek: only ${worst.count} of your squad have a fixture in GW${worst.gw}. Free Hit a full XI of teams that do play.`,
      };
    }
    return {
      reason:
        "No blank gameweek in this window yet — hold it. Blanks usually appear when cup rounds displace fixtures; re-check after each cup draw.",
    };
  }

  if (chip === "wildcard") {
    if (wildcardGain >= 15) {
      return {
        recommendedGw: gws[0],
        reason: `Your top transfer upgrades add ~${r1(wildcardGain)} xPts over the next few weeks — more than free transfers can deliver. Consider wildcarding now (window closes GW${def.stop_event}).`,
      };
    }
    return {
      reason: `Available upgrades add only ~${r1(wildcardGain)} xPts right now — free transfers cover it. Hold for an injury crisis or a fixture swing; the window closes GW${def.stop_event}.`,
    };
  }

  return { reason: "No recommendation logic for this chip yet." };
}

"use client";

import { useMemo } from "react";
import TeamIdGate from "@/components/TeamIdGate";
import { ErrorNote, Loading, SeasonBanner } from "@/components/ui";
import { adviseChips, type ChipAdvice } from "@/lib/chips";
import {
  buildProjectionContext,
  findUpgrades,
  projectPlayers,
  type PlayerProjection,
} from "@/lib/projection";
import type { Bootstrap, EntryData, Fixture } from "@/lib/types";
import { useBootstrap, useEntry, useFixtures } from "@/lib/useFpl";

export default function ChipsPage() {
  return <TeamIdGate>{(teamId) => <Chips teamId={teamId} />}</TeamIdGate>;
}

function Chips({ teamId }: { teamId: number }) {
  const bootstrap = useBootstrap();
  const fixtures = useFixtures();
  const entry = useEntry(teamId);

  const error = bootstrap.error ?? fixtures.error ?? entry.error;
  if (error) return <ErrorNote message={error} />;
  if (!bootstrap.data || !fixtures.data || !entry.data)
    return <Loading what="chip strategy" />;

  return (
    <Advice bootstrap={bootstrap.data} fixtures={fixtures.data} entry={entry.data} />
  );
}

function Advice({
  bootstrap,
  fixtures,
  entry,
}: {
  bootstrap: Bootstrap;
  fixtures: Fixture[];
  entry: EntryData;
}) {
  const advice = useMemo(() => {
    if (!entry.picks) return null;
    const ctx = buildProjectionContext(fixtures, bootstrap.events, bootstrap.teams);

    // Project to the end of the season — chip timing looks at every remaining GW.
    const restOfSeason = ctx.nextGw !== null ? ctx.lastGw - ctx.nextGw + 1 : 5;
    const market = projectPlayers(bootstrap.players, ctx, restOfSeason);

    const squadIds = new Set(entry.picks.map((p) => p.element));
    const squad = [...squadIds]
      .map((id) => market.get(id))
      .filter((s): s is PlayerProjection => s !== undefined);

    // Wildcard input: how much would the top 5 individual upgrades add?
    const teamCounts: Record<number, number> = {};
    for (const s of squad) teamCounts[s.player.team] = (teamCounts[s.player.team] ?? 0) + 1;
    const bank = entry.entryHistory?.bank ?? 0;
    const wildcardGain = squad
      .map(
        (s) =>
          findUpgrades(s, market, squadIds, teamCounts, s.player.now_cost + bank, 1)[0]
            ?.deltaEp ?? 0,
      )
      .sort((a, b) => b - a)
      .slice(0, 5)
      .reduce((a, b) => a + b, 0);

    return {
      ctx,
      chips: adviseChips({
        chipDefs: bootstrap.chips,
        chipsUsed: entry.chipsUsed,
        squad,
        ctx,
        wildcardGain,
      }),
    };
  }, [bootstrap, fixtures, entry]);

  if (!advice)
    return (
      <p className="text-sm text-muted">
        No squad data for this team yet — chip advice needs a picked squad.
      </p>
    );

  const halves = new Map<string, ChipAdvice[]>();
  for (const c of advice.chips) {
    const key =
      c.def.stop_event <= 19
        ? `First half (until GW${c.def.stop_event})`
        : `Second half (GW${c.def.start_event}–${c.def.stop_event})`;
    if (!halves.has(key)) halves.set(key, []);
    halves.get(key)!.push(c);
  }

  return (
    <div>
      <SeasonBanner events={bootstrap.events} />
      <h1 className="text-xl font-semibold tracking-tight">Chip strategy</h1>
      <p className="mt-1 mb-4 text-sm text-ink-2">
        When to play each chip, based on your squad's projected points for
        every remaining gameweek — doubles and blanks included. Timing advice
        firms up as fixtures (and cup reschedules) are confirmed, so re-check
        after big fixture news.
      </p>

      {advice.ctx.nextGw === null && (
        <div className="card mb-4 px-4 py-3 text-sm text-ink-2">
          Chip timing needs the new season's fixtures — recommendations will
          appear here as soon as the FPL game relaunches.
        </div>
      )}

      <div className="space-y-6">
        {[...halves.entries()].map(([window, chips]) => (
          <section key={window}>
            <h2 className="mb-2 text-sm font-medium text-muted">
              Window {window}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {chips.map((c) => (
                <ChipCard key={c.def.id} advice={c} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function ChipCard({ advice }: { advice: ChipAdvice }) {
  const badge = {
    used: { text: `Used GW${advice.usedAtGw}`, cls: "border-baseline text-muted" },
    expired: { text: "Expired", cls: "border-baseline text-muted" },
    open: { text: "Available", cls: "border-good/60 text-good" },
    upcoming: {
      text: `Opens GW${advice.def.start_event}`,
      cls: "border-baseline text-ink-2",
    },
  }[advice.status];

  return (
    <div className={`card px-4 py-3 ${advice.status === "used" || advice.status === "expired" ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{advice.label}</span>
        <span className={`rounded border px-1.5 py-0.5 text-[10px] font-medium ${badge.cls}`}>
          {badge.text}
        </span>
      </div>
      {advice.recommendedGw && (
        <div className="mt-2 text-sm font-semibold text-accent">
          Play in GW{advice.recommendedGw}
        </div>
      )}
      <p className="mt-1 text-sm text-ink-2">{advice.reason}</p>
    </div>
  );
}

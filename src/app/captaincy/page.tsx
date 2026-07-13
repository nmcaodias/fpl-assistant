"use client";

import { useMemo } from "react";
import TeamIdGate from "@/components/TeamIdGate";
import { ErrorNote, Loading, ScoreBar, SeasonBanner, StatusBadge } from "@/components/ui";
import {
  buildFixtureContext,
  CAPTAINCY_WEIGHTS,
  scorePlayers,
  type FixtureContext,
  type Scored,
} from "@/lib/scoring";
import type { Bootstrap, EntryData, Fixture } from "@/lib/types";
import { useBootstrap, useEntry, useFixtures } from "@/lib/useFpl";

export default function CaptaincyPage() {
  return <TeamIdGate>{(teamId) => <Captaincy teamId={teamId} />}</TeamIdGate>;
}

function Captaincy({ teamId }: { teamId: number }) {
  const bootstrap = useBootstrap();
  const fixtures = useFixtures();
  const entry = useEntry(teamId);

  const error = bootstrap.error ?? fixtures.error ?? entry.error;
  if (error) return <ErrorNote message={error} />;
  if (!bootstrap.data || !fixtures.data || !entry.data)
    return <Loading what="captaincy picks" />;

  return (
    <Ranking bootstrap={bootstrap.data} fixtures={fixtures.data} entry={entry.data} />
  );
}

function Ranking({
  bootstrap,
  fixtures,
  entry,
}: {
  bootstrap: Bootstrap;
  fixtures: Fixture[];
  entry: EntryData;
}) {
  const result = useMemo(() => {
    if (!entry.picks) return null;
    const ctx = buildFixtureContext(fixtures, bootstrap.events);
    const squadIds = new Set(entry.picks.map((p) => p.element));
    const squad = bootstrap.players.filter((p) => squadIds.has(p.id));
    // Normalize within the squad as one bucket — captaincy compares across
    // positions, and only the next gameweek's fixture matters.
    const scored = scorePlayers(squad, ctx, CAPTAINCY_WEIGHTS, 1, () => 0);
    const ranked = [...scored.values()].sort((a, b) => b.score - a.score);
    return { ranked, ctx };
  }, [bootstrap, fixtures, entry]);

  if (!result)
    return (
      <p className="text-sm text-muted">
        No squad data for this team yet — captaincy picks need a picked squad.
      </p>
    );

  const teamsById = new Map(bootstrap.teams.map((t) => [t.id, t]));
  const currentCaptain = entry.picks?.find((p) => p.is_captain)?.element;

  return (
    <div>
      <SeasonBanner events={bootstrap.events} />
      <h1 className="text-xl font-semibold tracking-tight">Captaincy picks</h1>
      <p className="mt-1 mb-4 text-sm text-ink-2">
        Your squad ranked for the armband — weighted towards expected points and
        form, with next fixture difficulty factored in
        {result.ctx.nextGw !== null && ` (GW${result.ctx.nextGw})`}.
      </p>

      <ol className="space-y-2">
        {result.ranked.map((s, i) => (
          <li key={s.player.id}>
            <CaptainRow
              scored={s}
              rank={i + 1}
              max={result.ranked[0]?.score ?? 100}
              isCurrent={s.player.id === currentCaptain}
              teamShort={(id: number) => teamsById.get(id)?.short_name ?? "?"}
              ctx={result.ctx}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function CaptainRow({
  scored,
  rank,
  max,
  isCurrent,
  teamShort,
  ctx,
}: {
  scored: Scored;
  rank: number;
  max: number;
  isCurrent: boolean;
  teamShort: (id: number) => string;
  ctx: FixtureContext;
}) {
  const p = scored.player;
  const nextFixture =
    ctx.nextGw !== null
      ? (ctx.upcomingByTeam[p.team] ?? []).find((f) => f.event === ctx.nextGw)
      : undefined;

  const detail = [
    nextFixture
      ? `${nextFixture.isHome ? "vs" : "@"} ${teamShort(nextFixture.opponent)} (FDR ${nextFixture.difficulty})`
      : null,
    `xP ${p.ep_next}`,
    `form ${p.form}`,
    `PPG ${p.points_per_game}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <span className="w-6 text-center text-sm font-semibold tabular-nums text-muted">
        {rank}
      </span>
      <div className="min-w-40">
        <div className="font-medium">
          {p.web_name}
          <span className="ml-1.5 text-xs text-ink-2">{teamShort(p.team)}</span>
          {isCurrent && (
            <span className="ml-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">
              current C
            </span>
          )}
          <StatusBadge player={p} />
        </div>
        <div className="text-xs text-ink-2">{detail}</div>
      </div>
      <div className="ml-auto">
        <ScoreBar score={scored.score} max={max} />
      </div>
    </div>
  );
}

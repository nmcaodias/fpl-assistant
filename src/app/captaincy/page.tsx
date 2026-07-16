"use client";

import { useMemo } from "react";
import TeamIdGate from "@/components/TeamIdGate";
import { ErrorNote, FormBadge, Loading, ScoreBar, SeasonBanner, StatusBadge } from "@/components/ui";
import {
  buildProjectionContext,
  projectPlayers,
  type PlayerProjection,
  type ProjectionContext,
} from "@/lib/projection";
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
    const ctx = buildProjectionContext(fixtures, bootstrap.events, bootstrap.teams);
    const squadIds = new Set(entry.picks.map((p) => p.element));
    const squad = bootstrap.players.filter((p) => squadIds.has(p.id));
    const projections = projectPlayers(squad, ctx, 1);
    const ranked = [...projections.values()].sort((a, b) => {
      // Next-GW xPts when fixtures exist, per-match xPts between seasons.
      const av = ctx.nextGw !== null ? (a.perGw[0]?.ep ?? 0) : a.epPerMatch;
      const bv = ctx.nextGw !== null ? (b.perGw[0]?.ep ?? 0) : b.epPerMatch;
      return bv - av;
    });
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
  const epOf = (s: PlayerProjection) =>
    result.ctx.nextGw !== null ? (s.perGw[0]?.ep ?? 0) : s.epPerMatch;
  const maxEp = epOf(result.ranked[0]) || 1;

  return (
    <div>
      <SeasonBanner events={bootstrap.events} />
      <h1 className="text-xl font-semibold tracking-tight">Captaincy picks</h1>
      <p className="mt-1 mb-4 text-sm text-ink-2">
        Your squad ranked by projected points
        {result.ctx.nextGw !== null && ` for GW${result.ctx.nextGw}`} — the
        captain doubles this. High-owned picks protect your rank (the field has
        them too); low-owned picks are differentials that move you up when they
        pay off.
      </p>

      <ol className="space-y-2">
        {result.ranked.map((s, i) => (
          <li key={s.player.id}>
            <CaptainRow
              proj={s}
              ep={epOf(s)}
              rank={i + 1}
              max={maxEp}
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

function OwnershipTag({ owned }: { owned: number }) {
  if (owned >= 25)
    return (
      <span className="rounded border border-baseline px-1.5 py-0.5 text-[10px] font-medium text-ink-2">
        template · {owned}%
      </span>
    );
  if (owned <= 10)
    return (
      <span className="rounded border border-accent/50 px-1.5 py-0.5 text-[10px] font-medium text-accent">
        differential · {owned}%
      </span>
    );
  return (
    <span className="rounded border border-baseline px-1.5 py-0.5 text-[10px] font-medium text-muted">
      {owned}% owned
    </span>
  );
}

function CaptainRow({
  proj,
  ep,
  rank,
  max,
  isCurrent,
  teamShort,
  ctx,
}: {
  proj: PlayerProjection;
  ep: number;
  rank: number;
  max: number;
  isCurrent: boolean;
  teamShort: (id: number) => string;
  ctx: ProjectionContext;
}) {
  const p = proj.player;
  const gwFixtures = proj.perGw[0]?.fixtures ?? [];
  const fixtureText =
    ctx.nextGw === null
      ? `~${proj.epPerMatch} xPts per match`
      : gwFixtures.length === 0
        ? "blank gameweek"
        : gwFixtures
            .map(
              (f) =>
                `${f.isHome ? "vs" : "@"} ${teamShort(f.opponent)} (FDR ${f.difficulty})`,
            )
            .join(" + ");

  const detail = [
    fixtureText,
    gwFixtures.length >= 2 ? "DOUBLE" : null,
    `xGI/90 ${p.expected_goal_involvements_per_90.toFixed(2)}`,
    `${proj.xMins}′ avg`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="card flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <span className="w-6 text-center text-sm font-semibold tabular-nums text-muted">
        {rank}
      </span>
      <div className="min-w-48">
        <div className="font-medium">
          {p.web_name}
          <span className="ml-1.5 text-xs text-ink-2">{teamShort(p.team)}</span>
          {isCurrent && (
            <span className="ml-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">
              current C
            </span>
          )}
          <StatusBadge player={p} />
          <FormBadge form={proj.form} />
        </div>
        <div className="text-xs text-ink-2">{detail}</div>
      </div>
      <OwnershipTag owned={parseFloat(p.selected_by_percent) || 0} />
      <div className="ml-auto">
        <ScoreBar score={ep} max={max} />
      </div>
    </div>
  );
}

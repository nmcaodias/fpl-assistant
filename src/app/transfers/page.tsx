"use client";

import { useMemo } from "react";
import TeamIdGate from "@/components/TeamIdGate";
import { ErrorNote, FormBadge, Loading, SeasonBanner, StatusBadge } from "@/components/ui";
import { money } from "@/lib/format";
import {
  buildProjectionContext,
  findUpgrades,
  HIT_COST,
  projectPlayers,
  type PlayerProjection,
  type Upgrade,
} from "@/lib/projection";
import type { Bootstrap, EntryData, Fixture } from "@/lib/types";
import { POSITION_NAMES } from "@/lib/types";
import { useBootstrap, useEntry, useFixtures } from "@/lib/useFpl";

const HORIZON = 5;

export default function TransfersPage() {
  return <TeamIdGate>{(teamId) => <Transfers teamId={teamId} />}</TeamIdGate>;
}

function Transfers({ teamId }: { teamId: number }) {
  const bootstrap = useBootstrap();
  const fixtures = useFixtures();
  const entry = useEntry(teamId);

  const error = bootstrap.error ?? fixtures.error ?? entry.error;
  if (error) return <ErrorNote message={error} />;
  if (!bootstrap.data || !fixtures.data || !entry.data)
    return <Loading what="transfer analysis" />;

  return (
    <Analysis bootstrap={bootstrap.data} fixtures={fixtures.data} entry={entry.data} />
  );
}

function Analysis({
  bootstrap,
  fixtures,
  entry,
}: {
  bootstrap: Bootstrap;
  fixtures: Fixture[];
  entry: EntryData;
}) {
  const analysis = useMemo(() => {
    if (!entry.picks) return null;
    const ctx = buildProjectionContext(fixtures, bootstrap.events, bootstrap.teams);
    const market = projectPlayers(bootstrap.players, ctx, HORIZON);

    const squadIds = new Set(entry.picks.map((p) => p.element));
    const teamCounts: Record<number, number> = {};
    for (const id of squadIds) {
      const p = market.get(id)?.player;
      if (p) teamCounts[p.team] = (teamCounts[p.team] ?? 0) + 1;
    }
    const bank = entry.entryHistory?.bank ?? 0;

    // Squad ranked worst-first: the top of the list is who to consider selling.
    const squad = [...squadIds]
      .map((id) => market.get(id))
      .filter((s): s is PlayerProjection => s !== undefined)
      .sort((a, b) => a.horizonEp - b.horizonEp);

    const rows = squad.map((s) => ({
      out: s,
      upgrades: findUpgrades(s, market, squadIds, teamCounts, s.player.now_cost + bank),
    }));

    // Best single move overall — the "if you only do one thing" answer.
    const bestMove = rows
      .flatMap((r) => r.upgrades.map((u) => ({ out: r.out, u })))
      .sort((a, b) => b.u.deltaEp - a.u.deltaEp)[0];

    return { rows, bank, bestMove, ctx };
  }, [bootstrap, fixtures, entry]);

  if (!analysis)
    return (
      <p className="text-sm text-muted">
        No squad data for this team yet — transfer suggestions need a picked squad.
      </p>
    );

  const teamsById = new Map(bootstrap.teams.map((t) => [t.id, t]));
  const shortName = (teamId: number) => teamsById.get(teamId)?.short_name ?? "?";

  return (
    <div>
      <SeasonBanner events={bootstrap.events} />
      <h1 className="text-xl font-semibold tracking-tight">Transfer suggestions</h1>
      <p className="mt-1 mb-4 text-sm text-ink-2">
        Everything below is projected points (xPts) over the next {HORIZON}{" "}
        gameweeks — built from xG/xA per 90, projected minutes, clean-sheet
        odds, and fixture difficulty. A move is worth a −{HIT_COST} hit only if
        it gains more than {HIT_COST} xPts. Prices are market values, not your
        personal selling prices.
      </p>

      {analysis.bestMove && (
        <div className="card mb-4 border-accent/40 px-4 py-3 text-sm">
          <span className="font-medium">Best single move: </span>
          {analysis.bestMove.out.player.web_name} →{" "}
          {analysis.bestMove.u.candidate.player.web_name}{" "}
          <span className="text-good font-medium">
            +{analysis.bestMove.u.deltaEp} xPts
          </span>
          <span className="text-ink-2"> over {HORIZON} GWs</span>
          {analysis.bestMove.u.worthAHit && (
            <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">
              worth a hit
            </span>
          )}
        </div>
      )}

      <div className="space-y-3">
        {analysis.rows.map(({ out, upgrades }) => (
          <details key={out.player.id} className="card group">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="w-10 text-xs text-muted">
                {POSITION_NAMES[out.player.element_type]}
              </span>
              <span className="min-w-40 font-medium">
                {out.player.web_name}
                <span className="ml-1.5 text-xs text-ink-2">
                  {shortName(out.player.team)} · {money(out.player.now_cost)} ·{" "}
                  {out.xMins}′
                </span>
                <StatusBadge player={out.player} />
                <FormBadge form={out.form} />
              </span>
              <span className="text-sm tabular-nums">
                <span className="font-semibold">{out.horizonEp}</span>
                <span className="text-xs text-muted"> xPts / {HORIZON} GWs</span>
              </span>
              <span className="ml-auto text-xs text-accent">
                {upgrades.length > 0
                  ? `${upgrades.length} upgrade${upgrades.length > 1 ? "s" : ""} ▸`
                  : "keep"}
              </span>
            </summary>
            {upgrades.length > 0 && (
              <div className="overflow-x-auto border-t border-grid px-4 py-2">
                <UpgradeTable upgrades={upgrades} out={out} shortName={shortName} />
              </div>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}

function UpgradeTable({
  upgrades,
  out,
  shortName,
}: {
  upgrades: Upgrade[];
  out: PlayerProjection;
  shortName: (id: number) => string;
}) {
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Buy instead</th>
          <th>Team</th>
          <th className="num">Price</th>
          <th className="num">Δ cost</th>
          <th className="num">Mins</th>
          <th className="num">xPts</th>
          <th className="num">Δ xPts</th>
          <th>Hit?</th>
        </tr>
      </thead>
      <tbody>
        {upgrades.map(({ candidate: c, deltaEp, worthAHit }) => (
          <tr key={c.player.id}>
            <td className="font-medium">
              {c.player.web_name}
              <StatusBadge player={c.player} />
              <FormBadge form={c.form} />
            </td>
            <td className="text-ink-2">{shortName(c.player.team)}</td>
            <td className="num">{money(c.player.now_cost)}</td>
            <td className="num text-ink-2">
              {c.player.now_cost > out.player.now_cost ? "+" : ""}
              {((c.player.now_cost - out.player.now_cost) / 10).toFixed(1)}
            </td>
            <td className="num text-ink-2">{c.xMins}′</td>
            <td className="num font-semibold">{c.horizonEp}</td>
            <td className="num font-medium text-good">+{deltaEp}</td>
            <td>
              {worthAHit ? (
                <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">
                  worth −4
                </span>
              ) : (
                <span className="text-xs text-muted">only if free</span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

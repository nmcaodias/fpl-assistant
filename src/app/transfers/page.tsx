"use client";

import { useMemo } from "react";
import TeamIdGate from "@/components/TeamIdGate";
import { ErrorNote, Loading, ScoreBar, SeasonBanner, StatusBadge } from "@/components/ui";
import { money } from "@/lib/format";
import {
  buildFixtureContext,
  findUpgrades,
  scorePlayers,
  TRANSFER_WEIGHTS,
  type Scored,
} from "@/lib/scoring";
import type { Bootstrap, EntryData, Fixture } from "@/lib/types";
import { POSITION_NAMES } from "@/lib/types";
import { useBootstrap, useEntry, useFixtures } from "@/lib/useFpl";

const FIXTURE_HORIZON = 5;

export default function TransfersPage() {
  return (
    <TeamIdGate>{(teamId) => <Transfers teamId={teamId} />}</TeamIdGate>
  );
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
    <Analysis
      bootstrap={bootstrap.data}
      fixtures={fixtures.data}
      entry={entry.data}
    />
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
    const ctx = buildFixtureContext(fixtures, bootstrap.events);
    const market = scorePlayers(
      bootstrap.players,
      ctx,
      TRANSFER_WEIGHTS,
      FIXTURE_HORIZON,
    );

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
      .filter((s): s is Scored => s !== undefined)
      .sort((a, b) => a.score - b.score);

    const rows = squad.map((s) => ({
      out: s,
      upgrades: findUpgrades(
        s,
        market,
        squadIds,
        teamCounts,
        s.player.now_cost + bank,
      ),
    }));

    return { rows, bank };
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
        Your squad ranked weakest-first by a blend of points per game, form,
        expected points, fixture ease (next {FIXTURE_HORIZON} GWs) and value.
        Budget per swap = player price + {money(analysis.bank)} in the bank.
        Prices use current market value, not your personal selling price.
      </p>

      <div className="space-y-3">
        {analysis.rows.map(({ out, upgrades }) => (
          <details key={out.player.id} className="card group">
            <summary className="flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 [&::-webkit-details-marker]:hidden">
              <span className="w-10 text-xs text-muted">
                {POSITION_NAMES[out.player.element_type]}
              </span>
              <span className="min-w-32 font-medium">
                {out.player.web_name}
                <span className="ml-1.5 text-xs text-ink-2">
                  {shortName(out.player.team)} · {money(out.player.now_cost)}
                </span>
                <StatusBadge player={out.player} />
              </span>
              <ScoreBar score={out.score} />
              <span className="ml-auto text-xs text-accent">
                {upgrades.length > 0
                  ? `${upgrades.length} upgrade${upgrades.length > 1 ? "s" : ""} ▸`
                  : "keep"}
              </span>
            </summary>
            {upgrades.length > 0 && (
              <div className="overflow-x-auto border-t border-grid px-4 py-2">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Buy instead</th>
                      <th>Team</th>
                      <th className="num">Price</th>
                      <th className="num">Δ cost</th>
                      <th className="num">Points</th>
                      <th className="num">Owned</th>
                      <th>Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {upgrades.map((u) => (
                      <tr key={u.player.id}>
                        <td className="font-medium">
                          {u.player.web_name}
                          <StatusBadge player={u.player} />
                        </td>
                        <td className="text-ink-2">{shortName(u.player.team)}</td>
                        <td className="num">{money(u.player.now_cost)}</td>
                        <td className="num text-ink-2">
                          {u.player.now_cost > out.player.now_cost ? "+" : ""}
                          {((u.player.now_cost - out.player.now_cost) / 10).toFixed(1)}
                        </td>
                        <td className="num">{u.player.total_points}</td>
                        <td className="num text-ink-2">
                          {u.player.selected_by_percent}%
                        </td>
                        <td>
                          <ScoreBar score={u.score} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </details>
        ))}
      </div>
    </div>
  );
}

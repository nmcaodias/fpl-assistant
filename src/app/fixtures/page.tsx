"use client";

import { useMemo } from "react";
import { ErrorNote, Loading } from "@/components/ui";
import { buildFixtureContext, fixtureEase, type UpcomingFixture } from "@/lib/scoring";
import type { Bootstrap, Fixture } from "@/lib/types";
import { useBootstrap, useFixtures } from "@/lib/useFpl";

const HORIZON = 6;

export default function FixturesPage() {
  const bootstrap = useBootstrap();
  const fixtures = useFixtures();

  const error = bootstrap.error ?? fixtures.error;
  if (error) return <ErrorNote message={error} />;
  if (!bootstrap.data || !fixtures.data) return <Loading what="fixtures" />;

  return <FdrGrid bootstrap={bootstrap.data} fixtures={fixtures.data} />;
}

function FdrGrid({ bootstrap, fixtures }: { bootstrap: Bootstrap; fixtures: Fixture[] }) {
  const grid = useMemo(() => {
    const ctx = buildFixtureContext(fixtures, bootstrap.events);
    if (ctx.nextGw === null) return null;

    const gws = Array.from({ length: HORIZON }, (_, i) => (ctx.nextGw as number) + i)
      .filter((gw) => bootstrap.events.some((e) => e.id === gw));

    // Best fixtures first.
    const teams = [...bootstrap.teams].sort(
      (a, b) =>
        (fixtureEase(ctx, b.id, HORIZON) ?? 0) - (fixtureEase(ctx, a.id, HORIZON) ?? 0),
    );

    return { ctx, gws, teams };
  }, [bootstrap, fixtures]);

  if (!grid) {
    return (
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Fixture difficulty</h1>
        <div className="card mt-4 px-6 py-8 text-center text-sm text-ink-2">
          <p className="font-medium text-ink">The season is over.</p>
          <p className="mt-2">
            The fixture planner will fill in as soon as the new season's
            fixtures land in the FPL API — usually when the game relaunches in
            early July.
          </p>
        </div>
      </div>
    );
  }

  const teamsById = new Map(bootstrap.teams.map((t) => [t.id, t]));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Fixture difficulty</h1>
          <p className="mt-1 text-sm text-ink-2">
            Next {grid.gws.length} gameweeks, easiest run first. Cell shows the
            opponent; colour is FPL's difficulty rating for that match.
          </p>
        </div>
        <Legend />
      </div>

      <div className="card overflow-x-auto">
        <table className="data-table">
          <thead>
            <tr>
              <th>Team</th>
              {grid.gws.map((gw) => (
                <th key={gw} className="text-center">
                  GW{gw}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {grid.teams.map((team) => {
              const byGw = new Map<number, UpcomingFixture[]>();
              for (const f of grid.ctx.upcomingByTeam[team.id] ?? []) {
                if (!byGw.has(f.event)) byGw.set(f.event, []);
                byGw.get(f.event)!.push(f);
              }
              return (
                <tr key={team.id}>
                  <td className="font-medium">{team.short_name}</td>
                  {grid.gws.map((gw) => (
                    <td key={gw} className="p-1 text-center">
                      <div className="flex flex-col gap-0.5">
                        {(byGw.get(gw) ?? []).map((f, i) => (
                          <FdrCell
                            key={i}
                            fixture={f}
                            opponent={teamsById.get(f.opponent)?.short_name ?? "?"}
                          />
                        ))}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FdrCell({ fixture, opponent }: { fixture: UpcomingFixture; opponent: string }) {
  const d = Math.min(5, Math.max(1, fixture.difficulty));
  return (
    <span
      title={`${fixture.isHome ? "Home vs" : "Away at"} ${opponent} — difficulty ${d}/5`}
      className="rounded px-1.5 py-1 text-xs font-medium"
      style={{
        background: `var(--fdr${d})`,
        color: `var(--fdr${d}-ink)`,
      }}
    >
      {fixture.isHome ? opponent : opponent.toLowerCase()}
      <span className="ml-1 opacity-70">{fixture.isHome ? "H" : "A"}</span>
    </span>
  );
}

function Legend() {
  return (
    <div className="flex items-center gap-1.5 text-xs text-ink-2">
      <span className="mr-1">Easy</span>
      {[1, 2, 3, 4, 5].map((d) => (
        <span
          key={d}
          className="rounded px-1.5 py-0.5 font-medium"
          style={{ background: `var(--fdr${d})`, color: `var(--fdr${d}-ink)` }}
        >
          {d}
        </span>
      ))}
      <span className="ml-1">Hard</span>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import { ErrorNote, FormBadge, Loading, SeasonBanner, StatusBadge } from "@/components/ui";
import { money } from "@/lib/format";
import { buildProjectionContext, projectPlayers } from "@/lib/projection";
import type { PlayerProjection } from "@/lib/projection";
import { buildSquad } from "@/lib/squad-builder";
import type { Bootstrap, Fixture, Position } from "@/lib/types";
import { POSITION_NAMES } from "@/lib/types";
import { useBootstrap, useFixtures } from "@/lib/useFpl";

const HORIZON = 5;

/**
 * Initial-squad builder. Deliberately not behind the team-ID gate: its whole
 * point is the moment you don't have a team yet (season launch, or a wildcard
 * rebuild mid-season).
 */
export default function SquadPage() {
  const bootstrap = useBootstrap();
  const fixtures = useFixtures();

  const error = bootstrap.error ?? fixtures.error;
  if (error) return <ErrorNote message={error} />;
  if (!bootstrap.data || !fixtures.data) return <Loading what="squad builder" />;

  return <Builder bootstrap={bootstrap.data} fixtures={fixtures.data} />;
}

function Builder({ bootstrap, fixtures }: { bootstrap: Bootstrap; fixtures: Fixture[] }) {
  const [budget, setBudget] = useState(100.0);

  const result = useMemo(() => {
    const ctx = buildProjectionContext(fixtures, bootstrap.events, bootstrap.teams);
    const market = projectPlayers(bootstrap.players, ctx, HORIZON);
    const squad = buildSquad(market, Math.round(budget * 10));
    return { ctx, squad };
  }, [bootstrap, fixtures, budget]);

  const teamsById = new Map(bootstrap.teams.map((t) => [t.id, t]));
  const shortName = (id: number) => teamsById.get(id)?.short_name ?? "?";

  return (
    <div>
      <SeasonBanner events={bootstrap.events} />
      <h1 className="text-xl font-semibold tracking-tight">Squad builder</h1>
      <p className="mt-1 mb-4 text-sm text-ink-2">
        The best legal 15 the engine can find for your budget: 2 GK, 5 DEF, 5
        MID, 3 FWD, at most three per club. It optimises the starting XI plus a
        doubled captain — that&apos;s what stops it drifting into a team of
        mid-price &quot;value&quot; picks with nobody worth the armband — and
        weights the bench low, which is why cheap enablers appear there on
        their own. Works for the season launch or a wildcard rebuild.
      </p>
      <p className="mb-4 text-xs text-muted">
        Projections come from played football, so brand-new signings and newly
        promoted teams are underrated until they have minutes. Prices are
        today&apos;s market prices.
      </p>

      <div className="card mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-ink-2">Budget</span>
          <input
            type="number"
            min={80}
            max={120}
            step={0.5}
            value={budget}
            onChange={(e) => {
              const v = parseFloat(e.target.value);
              if (Number.isFinite(v)) setBudget(Math.min(120, Math.max(80, v)));
            }}
            className="w-24 rounded border border-grid bg-surface px-2 py-1 tabular-nums"
          />
          <span className="text-ink-2">£m</span>
        </label>
        {result.squad && (
          <span className="text-xs text-muted">
            Spend {money(result.squad.costTenths)} · bank {money(result.squad.bankTenths)} ·
            XI projects {result.squad.xiEp} xPts
            {result.ctx.nextGw !== null && ` over GW${result.ctx.nextGw}–${result.ctx.nextGw + HORIZON - 1}`}
            {" "}(captain doubled: {result.squad.objective})
          </span>
        )}
      </div>

      {!result.squad ? (
        <div className="card px-6 py-8 text-center text-sm text-ink-2">
          No legal squad fits £{budget.toFixed(1)}m — raise the budget.
        </div>
      ) : (
        <SquadView
          starters={result.squad.starters}
          bench={result.squad.bench}
          captainId={result.squad.captain.player.id}
          shortName={shortName}
        />
      )}
    </div>
  );
}

function SquadView({
  starters,
  bench,
  captainId,
  shortName,
}: {
  starters: PlayerProjection[];
  bench: PlayerProjection[];
  captainId: number;
  shortName: (id: number) => string;
}) {
  const rows: { title: string; players: PlayerProjection[] }[] = (
    [1, 2, 3, 4] as Position[]
  ).map((pos) => ({
    title: POSITION_NAMES[pos],
    players: starters.filter((p) => p.player.element_type === pos),
  }));

  return (
    <div className="space-y-4">
      <div className="card px-4 py-3">
        <h2 className="mb-2 text-sm font-semibold">
          Starting XI{" "}
          <span className="font-normal text-xs text-muted">
            {rows.slice(1).map((r) => r.players.length).join("-")}
          </span>
        </h2>
        <div className="space-y-2">
          {rows.map(
            (row) =>
              row.players.length > 0 && (
                <div key={row.title} className="flex flex-wrap gap-2">
                  {row.players.map((p) => (
                    <PlayerCard
                      key={p.player.id}
                      proj={p}
                      isCaptain={p.player.id === captainId}
                      team={shortName(p.player.team)}
                    />
                  ))}
                </div>
              ),
          )}
        </div>
      </div>

      <div className="card px-4 py-3">
        <h2 className="mb-2 text-sm font-semibold">Bench</h2>
        <div className="flex flex-wrap gap-2">
          {bench.map((p) => (
            <PlayerCard
              key={p.player.id}
              proj={p}
              isCaptain={false}
              team={shortName(p.player.team)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function PlayerCard({
  proj,
  isCaptain,
  team,
}: {
  proj: PlayerProjection;
  isCaptain: boolean;
  team: string;
}) {
  const p = proj.player;
  return (
    <div className="rounded-md border border-grid px-3 py-2 text-sm">
      <div className="font-medium">
        {p.web_name}
        {isCaptain && (
          <span className="ml-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">
            C
          </span>
        )}
        <StatusBadge player={p} />
        <FormBadge form={proj.form} />
      </div>
      <div className="mt-0.5 text-xs text-ink-2">
        {POSITION_NAMES[p.element_type]} · {team} · {money(p.now_cost)} ·{" "}
        <span className="tabular-nums">{proj.horizonEp} xPts</span>
      </div>
    </div>
  );
}

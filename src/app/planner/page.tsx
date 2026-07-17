"use client";

import { useMemo, useState } from "react";
import TeamIdGate from "@/components/TeamIdGate";
import { ErrorNote, FormBadge, Loading, SeasonBanner, StatusBadge } from "@/components/ui";
import { money } from "@/lib/format";
import { MAX_FREE_TRANSFERS, planTransfers, type PlannedWeek } from "@/lib/planner";
import { buildProjectionContext, projectPlayers, summariseHistories } from "@/lib/projection";
import type { Bootstrap, EntryData, Fixture, PlayerHistories } from "@/lib/types";
import { useBootstrap, useEntry, useFixtures, usePlayerHistories } from "@/lib/useFpl";

const WEEKS = 5;

export default function PlannerPage() {
  return <TeamIdGate>{(teamId) => <Planner teamId={teamId} />}</TeamIdGate>;
}

function Planner({ teamId }: { teamId: number }) {
  const bootstrap = useBootstrap();
  const fixtures = useFixtures();
  const entry = useEntry(teamId);

  const squadIds = useMemo(
    () => entry.data?.picks?.map((p) => p.element) ?? [],
    [entry.data],
  );
  const histories = usePlayerHistories(squadIds);

  const error = bootstrap.error ?? fixtures.error ?? entry.error;
  if (error) return <ErrorNote message={error} />;
  if (!bootstrap.data || !fixtures.data || !entry.data)
    return <Loading what="transfer plan" />;

  return (
    <PlanView
      bootstrap={bootstrap.data}
      fixtures={fixtures.data}
      entry={entry.data}
      histories={histories.data}
    />
  );
}

function PlanView({
  bootstrap,
  fixtures,
  entry,
  histories,
}: {
  bootstrap: Bootstrap;
  fixtures: Fixture[];
  entry: EntryData;
  histories: PlayerHistories | null;
}) {
  const [freeTransfers, setFreeTransfers] = useState(1);
  const [allowHits, setAllowHits] = useState(true);

  const result = useMemo(() => {
    if (!entry.picks) return null;
    const ctx = buildProjectionContext(fixtures, bootstrap.events, bootstrap.teams);
    if (ctx.nextGw === null) return { ctx, plan: null };

    const recent = histories ? summariseHistories(histories) : undefined;
    const market = projectPlayers(bootstrap.players, ctx, WEEKS, recent);
    const plan = planTransfers(
      entry.picks.map((p) => p.element),
      market,
      ctx,
      {
        freeTransfers,
        bankTenths: entry.entryHistory?.bank ?? 0,
        weeks: WEEKS,
        allowHits,
      },
    );
    return { ctx, plan };
  }, [bootstrap, fixtures, entry, histories, freeTransfers, allowHits]);

  if (!result)
    return (
      <p className="text-sm text-muted">
        No squad data for this team yet — planning needs a picked squad.
      </p>
    );

  const teamsById = new Map(bootstrap.teams.map((t) => [t.id, t]));
  const shortName = (id: number) => teamsById.get(id)?.short_name ?? "?";

  return (
    <div>
      <SeasonBanner events={bootstrap.events} />
      <h1 className="text-xl font-semibold tracking-tight">Transfer plan</h1>
      <p className="mt-1 mb-4 text-sm text-ink-2">
        A {WEEKS}-gameweek plan, not a single swap: when to move, when to hold
        and bank a free transfer, and when a −4 hit actually pays. Scored by
        your best starting XI&apos;s xPts each week. Prices are market values, not
        your personal selling prices.
      </p>

      <div className="card mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-ink-2">Free transfers now</span>
          <select
            value={freeTransfers}
            onChange={(e) => setFreeTransfers(parseInt(e.target.value, 10))}
            className="rounded border border-grid bg-surface px-2 py-1"
          >
            {Array.from({ length: MAX_FREE_TRANSFERS + 1 }, (_, i) => (
              <option key={i} value={i}>
                {i}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={allowHits}
            onChange={(e) => setAllowHits(e.target.checked)}
          />
          <span className="text-ink-2">Allow −4 hits when they pay</span>
        </label>
        <span className="text-xs text-muted">
          Bank: {money(entry.entryHistory?.bank ?? 0)} (from your last deadline)
        </span>
      </div>

      {result.ctx.nextGw === null ? (
        <div className="card px-6 py-8 text-center text-sm text-ink-2">
          <p className="font-medium text-ink">The season is over.</p>
          <p className="mt-2">
            Planning needs upcoming fixtures — this page will light up as soon
            as the new season&apos;s fixtures land in the FPL API.
          </p>
        </div>
      ) : result.plan ? (
        <PlanTimeline plan={result.plan} shortName={shortName} />
      ) : (
        <p className="text-sm text-muted">Couldn&apos;t build a plan for this squad.</p>
      )}
    </div>
  );
}

function PlanTimeline({
  plan,
  shortName,
}: {
  plan: NonNullable<ReturnType<typeof planTransfers>>;
  shortName: (id: number) => string;
}) {
  return (
    <div>
      <div className="card mb-4 border-accent/40 px-4 py-3 text-sm">
        <span className="font-medium">Following this plan projects </span>
        <span className="text-good font-semibold">+{plan.gain} xPts</span>
        <span className="text-ink-2">
          {" "}
          vs standing pat over {plan.weeks.length} gameweeks
          {plan.totalHitCost > 0 && ` (already net of −${plan.totalHitCost} in hits)`}
          .
        </span>
      </div>

      <ol className="space-y-3">
        {plan.weeks.map((week) => (
          <li key={week.gw}>
            <WeekCard week={week} shortName={shortName} />
          </li>
        ))}
      </ol>
    </div>
  );
}

function WeekCard({
  week,
  shortName,
}: {
  week: PlannedWeek;
  shortName: (id: number) => string;
}) {
  return (
    <div className="card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="font-semibold">GW{week.gw}</span>
        <span className="text-xs text-muted">
          {week.freeTransfers} FT at deadline
        </span>
        {week.hitCost > 0 && (
          <span className="rounded bg-bad/10 px-1.5 py-0.5 text-[10px] font-semibold text-bad border border-bad/40">
            hit −{week.hitCost}
          </span>
        )}
        <span className="ml-auto text-sm tabular-nums">
          <span className="font-medium">{week.xiEp}</span>
          <span className="text-xs text-muted"> XI xPts</span>
        </span>
      </div>

      {week.moves.length === 0 ? (
        <p className="mt-2 text-sm text-ink-2">
          Hold — bank the transfer{week.freeTransfers >= MAX_FREE_TRANSFERS ? " (already at the cap)" : ""}.
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {week.moves.map((m) => (
            <li key={m.in.player.id} className="flex flex-wrap items-center gap-x-2 text-sm">
              <span className="text-ink-2 line-through decoration-bad/60">
                {m.out.player.web_name}
                <span className="ml-1 text-xs">{shortName(m.out.player.team)}</span>
              </span>
              <span className="text-muted">→</span>
              <span className="font-medium">
                {m.in.player.web_name}
                <span className="ml-1 text-xs text-ink-2">
                  {shortName(m.in.player.team)} · {money(m.in.player.now_cost)}
                </span>
                <StatusBadge player={m.in.player} />
                <FormBadge form={m.in.form} />
              </span>
              <span className="ml-auto text-good text-xs font-medium tabular-nums">
                +{m.gain} xPts rest of plan
              </span>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 text-xs text-muted">
        Bank after: {money(week.bankAfter)}
      </div>
    </div>
  );
}

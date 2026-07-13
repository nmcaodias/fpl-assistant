"use client";

import TeamIdGate from "@/components/TeamIdGate";
import { ErrorNote, Loading, SeasonBanner, StatTile, StatusBadge } from "@/components/ui";
import { money, num } from "@/lib/format";
import type { Bootstrap, EntryData, Player } from "@/lib/types";
import { POSITION_NAMES } from "@/lib/types";
import { useBootstrap, useEntry } from "@/lib/useFpl";

const CHIP_NAMES: Record<string, string> = {
  wildcard: "Wildcard",
  freehit: "Free Hit",
  bboost: "Bench Boost",
  "3xc": "Triple Captain",
  manager: "Assistant Manager",
};

export default function DashboardPage() {
  return (
    <TeamIdGate>
      {(teamId, clear) => <Dashboard teamId={teamId} clear={clear} />}
    </TeamIdGate>
  );
}

function Dashboard({ teamId, clear }: { teamId: number; clear: () => void }) {
  const bootstrap = useBootstrap();
  const entry = useEntry(teamId);

  if (bootstrap.error) return <ErrorNote message={bootstrap.error} />;
  if (entry.error)
    return (
      <div className="space-y-3">
        <ErrorNote message={entry.error} />
        <button onClick={clear} className="text-sm text-accent underline">
          Use a different team ID
        </button>
      </div>
    );
  if (!bootstrap.data || !entry.data) return <Loading what="your team" />;

  return <TeamView data={entry.data} bootstrap={bootstrap.data} clear={clear} />;
}

function TeamView({
  data,
  bootstrap,
  clear,
}: {
  data: EntryData;
  bootstrap: Bootstrap;
  clear: () => void;
}) {
  const { entry, picks, entryHistory, chipsUsed, activeChip } = data;
  const playersById = new Map(bootstrap.players.map((p) => [p.id, p]));
  const teamsById = new Map(bootstrap.teams.map((t) => [t.id, t]));

  const squadValue =
    entryHistory !== null ? entryHistory.value - entryHistory.bank : null;

  return (
    <div>
      <SeasonBanner events={bootstrap.events} />

      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">{entry.name}</h1>
          <p className="text-sm text-ink-2">
            {entry.player_first_name} {entry.player_last_name} · team ID{" "}
            {entry.id}
          </p>
        </div>
        <button onClick={clear} className="text-sm text-accent underline">
          Switch team
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Overall points" value={num(entry.summary_overall_points)} />
        <StatTile label="Overall rank" value={num(entry.summary_overall_rank)} />
        <StatTile
          label={`GW${entry.current_event ?? "—"} points`}
          value={num(entry.summary_event_points)}
          hint={
            entryHistory ? `${entryHistory.points_on_bench} left on bench` : undefined
          }
        />
        <StatTile
          label="Squad value"
          value={squadValue !== null ? money(squadValue) : "—"}
        />
        <StatTile
          label="In the bank"
          value={entryHistory ? money(entryHistory.bank) : "—"}
        />
      </div>

      {(chipsUsed.length > 0 || activeChip) && (
        <p className="mt-3 text-sm text-ink-2">
          <span className="text-muted">Chips used:</span>{" "}
          {chipsUsed
            .map((c) => `${CHIP_NAMES[c.name] ?? c.name} (GW${c.event})`)
            .join(", ") || "none"}
          {activeChip && ` · Active: ${CHIP_NAMES[activeChip] ?? activeChip}`}
        </p>
      )}

      {picks ? (
        <SquadTable picks={picks} playersById={playersById} teamsById={teamsById} />
      ) : (
        <p className="mt-6 text-sm text-muted">
          No squad picks available for this team yet.
        </p>
      )}
    </div>
  );
}

function SquadTable({
  picks,
  playersById,
  teamsById,
}: {
  picks: NonNullable<EntryData["picks"]>;
  playersById: Map<number, Player>;
  teamsById: Map<number, { short_name: string }>;
}) {
  const sorted = [...picks].sort((a, b) => a.position - b.position);
  const starters = sorted.filter((p) => p.position <= 11);
  const bench = sorted.filter((p) => p.position > 11);

  const row = (pick: (typeof picks)[number]) => {
    const p = playersById.get(pick.element);
    if (!p) return null;
    return (
      <tr key={pick.element}>
        <td className="text-muted">{POSITION_NAMES[p.element_type]}</td>
        <td>
          <span className="font-medium">{p.web_name}</span>
          {pick.is_captain && (
            <span className="ml-1.5 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold text-accent-ink">
              C
            </span>
          )}
          {pick.is_vice_captain && (
            <span className="ml-1.5 rounded border border-baseline px-1.5 py-0.5 text-[10px] font-semibold text-ink-2">
              V
            </span>
          )}
          <StatusBadge player={p} />
        </td>
        <td className="text-ink-2">{teamsById.get(p.team)?.short_name ?? "?"}</td>
        <td className="num">{money(p.now_cost)}</td>
        <td className="num font-medium">{p.total_points}</td>
        <td className="num">{p.points_per_game}</td>
        <td className="num">{p.form}</td>
        <td className="num text-ink-2">{p.selected_by_percent}%</td>
      </tr>
    );
  };

  const head = (
    <tr>
      <th>Pos</th>
      <th>Player</th>
      <th>Team</th>
      <th className="num">Price</th>
      <th className="num">Points</th>
      <th className="num">PPG</th>
      <th className="num">Form</th>
      <th className="num">Owned</th>
    </tr>
  );

  return (
    <div className="mt-6 space-y-4">
      <div className="card overflow-x-auto">
        <div className="px-4 pt-3 text-sm font-medium">Starting XI</div>
        <table className="data-table mt-1">
          <thead>{head}</thead>
          <tbody>{starters.map(row)}</tbody>
        </table>
      </div>
      <div className="card overflow-x-auto">
        <div className="px-4 pt-3 text-sm font-medium">Bench</div>
        <table className="data-table mt-1">
          <thead>{head}</thead>
          <tbody>{bench.map(row)}</tbody>
        </table>
      </div>
    </div>
  );
}

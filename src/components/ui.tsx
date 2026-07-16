"use client";

import type { Event, Player } from "@/lib/types";
import { STATUS_LABELS } from "@/lib/format";

export function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-ink-2">{hint}</div>}
    </div>
  );
}

export function Loading({ what }: { what: string }) {
  return <p className="py-8 text-center text-sm text-muted">Loading {what}…</p>;
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div className="card border-bad/40 px-4 py-3 text-sm">
      <span className="font-medium text-bad">Something went wrong: </span>
      <span className="text-ink-2">{message}</span>
    </div>
  );
}

/** Shown while the FPL game is between seasons. */
export function SeasonBanner({ events }: { events: Event[] }) {
  const next = events.find((e) => e.is_next) ?? events.find((e) => !e.finished);
  if (next) return null;
  return (
    <div className="card mb-4 px-4 py-3 text-sm text-ink-2">
      <span className="font-medium text-ink">Season complete.</span> The FPL
      game is between seasons — rankings below use full-season stats, and
      fixture-based advice will light up when the new season&apos;s game goes live
      (usually early July).
    </div>
  );
}

/** Availability flag next to a player's name; nothing when fully available. */
export function StatusBadge({ player }: { player: Player }) {
  if (player.status === "a") return null;
  const label =
    player.status === "d" && player.chance_of_playing_next_round !== null
      ? `${player.chance_of_playing_next_round}% chance`
      : (STATUS_LABELS[player.status] ?? "Flagged");
  return (
    <span
      title={player.news || label}
      className="ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-bad border border-bad/40"
    >
      {label}
    </span>
  );
}

/** Horizontal score bar, 0–100, single-series accent hue with a direct label. */
export function ScoreBar({ score, max = 100 }: { score: number; max?: number }) {
  const pct = Math.max(0, Math.min(100, (score / max) * 100));
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-32 overflow-hidden rounded-full bg-grid">
        <div
          className="h-full rounded-full bg-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-ink-2">{score.toFixed(1)}</span>
    </div>
  );
}

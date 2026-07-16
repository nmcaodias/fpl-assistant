"use client";

import { useState } from "react";
import { useTeamId } from "@/lib/useFpl";

/**
 * Renders children once an FPL team ID is set; otherwise shows the form to
 * enter one. The ID persists in localStorage across pages and visits.
 */
export default function TeamIdGate({
  children,
}: {
  children: (teamId: number, clear: () => void) => React.ReactNode;
}) {
  const [teamId, setTeamId, ready] = useTeamId();
  const [draft, setDraft] = useState("");

  if (!ready) return null;

  if (teamId) return <>{children(teamId, () => setTeamId(null))}</>;

  return (
    <div className="card mx-auto mt-8 max-w-md px-6 py-6">
      <h2 className="text-lg font-semibold">Connect your FPL team</h2>
      <p className="mt-2 text-sm text-ink-2">
        Enter your team ID — it&apos;s the number in the URL when you open the
        Points page on fantasy.premierleague.com:{" "}
        <span className="font-mono text-xs">…/entry/<b>1234567</b>/event/…</span>
      </p>
      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const id = parseInt(draft, 10);
          if (id > 0) setTeamId(id);
        }}
      >
        <input
          type="number"
          min={1}
          required
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="e.g. 1234567"
          className="w-full rounded-md border border-baseline bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
        >
          Load
        </button>
      </form>
    </div>
  );
}

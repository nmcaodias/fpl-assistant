import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The module keeps an in-memory cache at module scope, so each test gets a
// fresh instance via vi.resetModules() + a dynamic re-import.
async function freshModule() {
  vi.resetModules();
  return import("./fpl-server");
}

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

describe("fpl-server", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("getBootstrap", () => {
    it("fetches bootstrap-static and trims each entity to its known fields", async () => {
      const { getBootstrap } = await freshModule();
      const raw = {
        elements: [{ id: 1, web_name: "Salah", junk_field: "drop me", now_cost: 130 }],
        teams: [{ id: 1, name: "Arsenal", short_name: "ARS", strength: 4, junk: true }],
        events: [{ id: 1, name: "GW1", deadline_time: "x", finished: false, is_current: true, is_next: false, junk: 1 }],
        chips: [{ id: 1, name: "wildcard", start_event: 2, stop_event: 19, number: 1, junk: 1 }],
      };
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(raw));

      const data = await getBootstrap();

      expect(fetch).toHaveBeenCalledWith(
        "https://fantasy.premierleague.com/api/bootstrap-static/",
        expect.objectContaining({ cache: "no-store" }),
      );
      expect(data.players).toEqual([{ id: 1, web_name: "Salah", now_cost: 130 }]);
      expect(data.teams).toEqual([{ id: 1, name: "Arsenal", short_name: "ARS", strength: 4 }]);
      expect(data.events).toEqual([
        { id: 1, name: "GW1", deadline_time: "x", finished: false, is_current: true, is_next: false },
      ]);
      expect(data.chips).toEqual([{ id: 1, name: "wildcard", start_event: 2, stop_event: 19, number: 1 }]);
    });

    it("defaults chips to an empty array when the upstream response omits them", async () => {
      const { getBootstrap } = await freshModule();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ elements: [], teams: [], events: [] }),
      );
      const data = await getBootstrap();
      expect(data.chips).toEqual([]);
    });

    it("caches responses for repeated calls within the TTL window", async () => {
      vi.useFakeTimers();
      const { getBootstrap } = await freshModule();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ elements: [], teams: [], events: [] }),
      );

      await getBootstrap();
      await getBootstrap();
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("re-fetches once the TTL has expired", async () => {
      vi.useFakeTimers();
      const { getBootstrap } = await freshModule();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ elements: [], teams: [], events: [] }),
      );

      await getBootstrap();
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);
      await getBootstrap();
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("throws an FplError with the upstream status when the request fails", async () => {
      const { getBootstrap, FplError } = await freshModule();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 503));

      await expect(getBootstrap()).rejects.toBeInstanceOf(FplError);
      await expect(getBootstrap()).rejects.toMatchObject({ status: 503 });
    });
  });

  describe("getFixtures", () => {
    it("trims fixtures to the known fixture fields", async () => {
      const { getFixtures } = await freshModule();
      const raw = [
        {
          id: 1,
          event: 1,
          team_h: 1,
          team_a: 2,
          team_h_difficulty: 3,
          team_a_difficulty: 3,
          kickoff_time: "x",
          finished: false,
          team_h_score: null,
          team_a_score: null,
          stats: ["drop me"],
        },
      ];
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(raw));

      const data = await getFixtures();
      expect(data).toEqual([
        {
          id: 1,
          event: 1,
          team_h: 1,
          team_a: 2,
          team_h_difficulty: 3,
          team_a_difficulty: 3,
          kickoff_time: "x",
          finished: false,
          team_h_score: null,
          team_a_score: null,
        },
      ]);
    });
  });

  describe("getEntry", () => {
    const baseEntry = {
      id: 42,
      name: "Team Name",
      player_first_name: "A",
      player_last_name: "B",
      summary_overall_points: 100,
      summary_overall_rank: 5000,
      summary_event_points: 60,
      current_event: 10,
    };

    it("combines entry, picks, and chip history when all requests succeed", async () => {
      const { getEntry } = await freshModule();
      const picks = {
        active_chip: "3xc",
        entry_history: {
          event: 10,
          points: 60,
          total_points: 100,
          overall_rank: 5000,
          bank: 5,
          value: 1000,
          event_transfers: 1,
          points_on_bench: 4,
        },
        picks: [{ element: 1, position: 1, multiplier: 3, is_captain: true, is_vice_captain: false }],
      };
      const history = { chips: [{ name: "wildcard", event: 5 }] };

      (fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(jsonResponse(baseEntry))
        .mockResolvedValueOnce(jsonResponse(picks))
        .mockResolvedValueOnce(jsonResponse(history));

      const data = await getEntry(42);

      expect(fetch).toHaveBeenNthCalledWith(1, expect.stringContaining("/entry/42/"), expect.anything());
      expect(fetch).toHaveBeenNthCalledWith(2, expect.stringContaining("/entry/42/event/10/picks/"), expect.anything());
      expect(fetch).toHaveBeenNthCalledWith(3, expect.stringContaining("/entry/42/history/"), expect.anything());
      expect(data.entry.id).toBe(42);
      expect(data.picks).toEqual(picks.picks);
      expect(data.entryHistory).toEqual(picks.entry_history);
      expect(data.activeChip).toBe("3xc");
      expect(data.chipsUsed).toEqual(history.chips);
    });

    it("skips the picks request when the entry has no current_event", async () => {
      const { getEntry } = await freshModule();
      (fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(jsonResponse({ ...baseEntry, current_event: null }))
        .mockResolvedValueOnce(jsonResponse({ chips: [] }));

      const data = await getEntry(42);
      expect(fetch).toHaveBeenCalledTimes(2); // entry + history only
      expect(data.picks).toBeNull();
      expect(data.entryHistory).toBeNull();
      expect(data.activeChip).toBeNull();
    });

    it("falls back to null picks when the picks request fails, without failing the whole call", async () => {
      const { getEntry } = await freshModule();
      (fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(jsonResponse(baseEntry))
        .mockResolvedValueOnce(jsonResponse({}, false, 404))
        .mockResolvedValueOnce(jsonResponse({ chips: [] }));

      const data = await getEntry(42);
      expect(data.picks).toBeNull();
      expect(data.entryHistory).toBeNull();
      expect(data.activeChip).toBeNull();
    });

    it("falls back to an empty chip history when that request fails", async () => {
      const { getEntry } = await freshModule();
      (fetch as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce(jsonResponse({ ...baseEntry, current_event: null }))
        .mockResolvedValueOnce(jsonResponse({}, false, 500));

      const data = await getEntry(42);
      expect(data.chipsUsed).toEqual([]);
    });

    it("propagates a failure fetching the entry itself as an FplError", async () => {
      const { getEntry, FplError } = await freshModule();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({}, false, 404));

      await expect(getEntry(999)).rejects.toBeInstanceOf(FplError);
      await expect(getEntry(999)).rejects.toMatchObject({ status: 404 });
    });
  });

  describe("getPlayerHistories", () => {
    const historyRow = (round: number) => ({
      round,
      minutes: 90,
      starts: 1,
      expected_goals: "0.1",
      expected_assists: "0.2",
      defensive_contribution: 3,
      saves: 0,
      bonus: 1,
      total_points: 5,
      junk_field: "drop me",
    });

    it("fetches each player's element-summary, keeping only the last 5 matches", async () => {
      const { getPlayerHistories } = await freshModule();
      // Ten matches upstream; only the most recent five make up the window.
      const rows = Array.from({ length: 10 }, (_, i) => historyRow(i + 1));
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ history: rows }));

      const data = await getPlayerHistories([7]);

      expect(fetch).toHaveBeenCalledWith(
        "https://fantasy.premierleague.com/api/element-summary/7/",
        expect.objectContaining({ cache: "no-store" }),
      );
      expect(data[7]).toHaveLength(5);
      expect(data[7].map((r) => (r as { round: number }).round)).toEqual([6, 7, 8, 9, 10]);
      // Trimmed to known fields.
      expect(data[7][0]).not.toHaveProperty("junk_field");
      expect(data[7][0]).toMatchObject({ round: 6, minutes: 90, defensive_contribution: 3 });
    });

    it("keeps a short history as-is", async () => {
      const { getPlayerHistories } = await freshModule();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
        jsonResponse({ history: [historyRow(1), historyRow(2)] }),
      );

      const data = await getPlayerHistories([7]);
      expect(data[7]).toHaveLength(2);
    });

    it("omits a player whose fetch fails rather than failing the whole batch", async () => {
      const { getPlayerHistories } = await freshModule();
      (fetch as ReturnType<typeof vi.fn>).mockImplementation((url: string) =>
        Promise.resolve(
          url.includes("/element-summary/2/")
            ? jsonResponse({}, false, 500)
            : jsonResponse({ history: [historyRow(1)] }),
        ),
      );

      const data = await getPlayerHistories([1, 2, 3]);

      expect(Object.keys(data).sort()).toEqual(["1", "3"]);
    });

    it("de-duplicates ids and caps the batch at MAX_HISTORY_IDS", async () => {
      const { getPlayerHistories, MAX_HISTORY_IDS } = await freshModule();
      (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ history: [] }));

      await getPlayerHistories([4, 4, 4, 9]);
      expect(fetch).toHaveBeenCalledTimes(2);

      (fetch as ReturnType<typeof vi.fn>).mockClear();
      await getPlayerHistories(Array.from({ length: MAX_HISTORY_IDS + 50 }, (_, i) => i + 1000));
      expect(fetch).toHaveBeenCalledTimes(MAX_HISTORY_IDS);
    });

    it("never runs more than 5 upstream requests at once", async () => {
      const { getPlayerHistories } = await freshModule();
      let inFlight = 0;
      let peak = 0;
      (fetch as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((r) => setTimeout(r, 1));
        inFlight--;
        return jsonResponse({ history: [] });
      });

      await getPlayerHistories(Array.from({ length: 20 }, (_, i) => i + 1));

      expect(peak).toBeLessThanOrEqual(5);
      expect(fetch).toHaveBeenCalledTimes(20);
    });
  });
});

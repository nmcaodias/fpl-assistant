// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FplError } from "@/lib/fpl-server";

const getPlayerHistories = vi.fn();
vi.mock("@/lib/fpl-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fpl-server")>()),
  getPlayerHistories: (...args: unknown[]) => getPlayerHistories(...args),
}));

import { GET } from "./route";

const request = (query: string) => new Request(`http://localhost/api/fpl/players${query}`);

describe("GET /api/fpl/players", () => {
  beforeEach(() => {
    getPlayerHistories.mockReset();
  });

  it("returns the histories payload with a cache-control header on success", async () => {
    getPlayerHistories.mockResolvedValue({ 1: [], 2: [] });

    const res = await GET(request("?ids=1,2"));

    expect(res.status).toBe(200);
    expect(getPlayerHistories).toHaveBeenCalledWith([1, 2]);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600",
    );
    await expect(res.json()).resolves.toEqual({ 1: [], 2: [] });
  });

  it("rejects a missing ids parameter", async () => {
    const res = await GET(request(""));
    expect(res.status).toBe(400);
    expect(getPlayerHistories).not.toHaveBeenCalled();
  });

  it("rejects ids that aren't positive integers", async () => {
    for (const query of ["?ids=abc", "?ids=1,abc", "?ids=0", "?ids=-3", "?ids=1.5", "?ids="]) {
      const res = await GET(request(query));
      expect(res.status, query).toBe(400);
    }
    expect(getPlayerHistories).not.toHaveBeenCalled();
  });

  it("rejects a batch that would fan out to too many upstream requests", async () => {
    const ids = Array.from({ length: 101 }, (_, i) => i + 1).join(",");
    const res = await GET(request(`?ids=${ids}`));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Too many ids — 100 at most." });
    expect(getPlayerHistories).not.toHaveBeenCalled();
  });

  it("counts duplicates once against the batch cap", async () => {
    getPlayerHistories.mockResolvedValue({ 5: [] });
    const ids = Array.from({ length: 101 }, () => 5).join(",");
    const res = await GET(request(`?ids=${ids}`));
    expect(res.status).toBe(200);
  });

  it("returns a 502 with a friendly message when the upstream call fails", async () => {
    getPlayerHistories.mockRejectedValue(new FplError("boom", 500));

    const res = await GET(request("?ids=1"));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Could not reach the FPL API. Try again in a minute.",
    });
  });
});

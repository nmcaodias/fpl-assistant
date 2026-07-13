// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FplError } from "@/lib/fpl-server";

const getBootstrap = vi.fn();
vi.mock("@/lib/fpl-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fpl-server")>()),
  getBootstrap: (...args: unknown[]) => getBootstrap(...args),
}));

import { GET } from "./route";

describe("GET /api/fpl/bootstrap", () => {
  beforeEach(() => {
    getBootstrap.mockReset();
  });

  it("returns the bootstrap payload with a cache-control header on success", async () => {
    getBootstrap.mockResolvedValue({ players: [], teams: [], events: [], chips: [] });

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600",
    );
    await expect(res.json()).resolves.toEqual({ players: [], teams: [], events: [], chips: [] });
  });

  it("returns a 502 with a friendly message when the upstream call fails", async () => {
    getBootstrap.mockRejectedValue(new FplError("boom", 500));

    const res = await GET();

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Could not reach the FPL API. Try again in a minute.",
    });
  });
});

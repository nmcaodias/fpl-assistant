// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const getFixtures = vi.fn();
vi.mock("@/lib/fpl-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fpl-server")>()),
  getFixtures: (...args: unknown[]) => getFixtures(...args),
}));

import { GET } from "./route";

describe("GET /api/fpl/fixtures", () => {
  beforeEach(() => {
    getFixtures.mockReset();
  });

  it("returns the fixtures payload with a cache-control header on success", async () => {
    getFixtures.mockResolvedValue([{ id: 1, event: 1 }]);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=300, stale-while-revalidate=3600",
    );
    await expect(res.json()).resolves.toEqual([{ id: 1, event: 1 }]);
  });

  it("returns a 502 with a friendly message when the upstream call fails", async () => {
    getFixtures.mockRejectedValue(new Error("network error"));

    const res = await GET();

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Could not reach the FPL API. Try again in a minute.",
    });
  });
});

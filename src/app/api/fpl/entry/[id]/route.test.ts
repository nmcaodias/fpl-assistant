// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FplError } from "@/lib/fpl-server";

const getEntry = vi.fn();
vi.mock("@/lib/fpl-server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/fpl-server")>()),
  getEntry: (...args: unknown[]) => getEntry(...args),
}));

import { GET } from "./route";

function req() {
  return new Request("http://localhost/api/fpl/entry/42");
}

describe("GET /api/fpl/entry/[id]", () => {
  beforeEach(() => {
    getEntry.mockReset();
  });

  it("rejects a non-numeric id", async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: "abc" }) });
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Invalid team ID." });
    expect(getEntry).not.toHaveBeenCalled();
  });

  it("rejects a zero or negative id", async () => {
    const res = await GET(req(), { params: Promise.resolve({ id: "0" }) });
    expect(res.status).toBe(400);
    expect(getEntry).not.toHaveBeenCalled();
  });

  it("returns the entry payload with a cache-control header on success", async () => {
    getEntry.mockResolvedValue({ entry: { id: 42 }, picks: null });

    const res = await GET(req(), { params: Promise.resolve({ id: "42" }) });

    expect(getEntry).toHaveBeenCalledWith(42);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(
      "public, s-maxage=120, stale-while-revalidate=600",
    );
    await expect(res.json()).resolves.toEqual({ entry: { id: 42 }, picks: null });
  });

  it("returns a 404 with a friendly message when the team doesn't exist", async () => {
    getEntry.mockRejectedValue(new FplError("not found", 404));

    const res = await GET(req(), { params: Promise.resolve({ id: "999999" }) });

    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({
      error: "No FPL team found with ID 999999.",
    });
  });

  it("returns a 502 for any other upstream failure", async () => {
    getEntry.mockRejectedValue(new FplError("server error", 500));

    const res = await GET(req(), { params: Promise.resolve({ id: "42" }) });

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Could not reach the FPL API. Try again in a minute.",
    });
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useJson, useTeamId } from "./useFpl";

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

let urlSeq = 0;
/** Each test gets its own URL so the module-level session cache can't leak between tests. */
function uniqueUrl() {
  return `/api/test/${urlSeq++}`;
}

describe("useJson", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns an idle state when the url is null", () => {
    const { result } = renderHook(() => useJson(null));
    expect(result.current).toEqual({ data: null, error: null, loading: false });
  });

  it("starts loading and resolves with data on a successful fetch", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ hello: "world" }));
    const url = uniqueUrl();
    const { result } = renderHook(() => useJson(url));

    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.data).toEqual({ hello: "world" });
    expect(result.current.error).toBeNull();
  });

  it("surfaces the server-provided error message on a failed response", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      jsonResponse({ error: "Team not found" }, false, 404),
    );
    const url = uniqueUrl();
    const { result } = renderHook(() => useJson(url));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Team not found");
    expect(result.current.data).toBeNull();
  });

  it("falls back to a generic message when a failed response has no error body", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse(null, false, 502));
    const url = uniqueUrl();
    const { result } = renderHook(() => useJson(url));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("Request failed (502)");
  });

  it("surfaces a network failure's message", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("network down"));
    const url = uniqueUrl();
    const { result } = renderHook(() => useJson(url));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("network down");
  });

  it("serves a second mount from the session cache without re-fetching", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValue(jsonResponse({ cached: true }));
    const url = uniqueUrl();

    const first = renderHook(() => useJson(url));
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    expect(fetch).toHaveBeenCalledTimes(1);

    const second = renderHook(() => useJson(url));
    // Cached data is returned synchronously, no loading flash.
    expect(second.result.current).toEqual({ data: { cached: true }, error: null, loading: false });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("useTeamId", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("is not ready until the localStorage read effect has run, then reports null with none stored", async () => {
    const { result } = renderHook(() => useTeamId());
    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[0]).toBeNull();
  });

  it("loads a previously stored team id on mount", async () => {
    localStorage.setItem("fpl-team-id", "1234567");
    const { result } = renderHook(() => useTeamId());
    await waitFor(() => expect(result.current[2]).toBe(true));
    expect(result.current[0]).toBe(1234567);
  });

  it("persists a new team id to localStorage and updates state", async () => {
    const { result } = renderHook(() => useTeamId());
    await waitFor(() => expect(result.current[2]).toBe(true));

    act(() => result.current[1](7654321));

    expect(result.current[0]).toBe(7654321);
    expect(localStorage.getItem("fpl-team-id")).toBe("7654321");
  });

  it("clears the stored team id when set to null", async () => {
    localStorage.setItem("fpl-team-id", "111");
    const { result } = renderHook(() => useTeamId());
    await waitFor(() => expect(result.current[2]).toBe(true));

    act(() => result.current[1](null));

    expect(result.current[0]).toBeNull();
    expect(localStorage.getItem("fpl-team-id")).toBeNull();
  });
});

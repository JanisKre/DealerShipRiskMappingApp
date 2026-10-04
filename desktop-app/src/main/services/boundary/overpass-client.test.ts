/**
 * Regression cover for analyses that appeared to hang: the per-attempt
 * timeout used to stop at the response headers, and nothing bounded the walk
 * across all mirrors for optional lookups.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchOverpass, resetOverpassCircuits } from "./overpass-client";

/** A response whose headers arrive at once but whose body never completes. */
function stalledBodyResponse(): Response {
  // No source callbacks: the stream never enqueues and never closes.
  return new Response(new ReadableStream(), { status: 200 });
}

beforeEach(() => {
  vi.useFakeTimers();
  resetOverpassCircuits();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchOverpass", () => {
  it("gives up on a body that stalls after the headers and tries the next mirror", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(stalledBodyResponse())
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ elements: [{ id: 1 }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchOverpass<{ id: number }>("[out:json];node(1);out;");
    await vi.advanceTimersByTimeAsync(30_000);

    await expect(pending).resolves.toEqual({ elements: [{ id: 1 }] });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns null once the overall budget is spent instead of walking every mirror", async () => {
    const fetchMock = vi.fn(() => Promise.resolve(stalledBodyResponse()));
    vi.stubGlobal("fetch", fetchMock);

    const pending = fetchOverpass("[out:json];node(1);out;", { budgetMs: 5_000 });
    await vi.advanceTimersByTimeAsync(5_000);

    await expect(pending).resolves.toBeNull();
    // One attempt consumed the whole budget; without it, 8 attempts × 30 s.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

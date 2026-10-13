import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetchWithResilience: vi.fn(),
}));

vi.mock("./http.service", () => ({
  fetchWithResilience: mocks.fetchWithResilience,
}));
// Pass-through cache: these tests cover the lookup, not persistence.
vi.mock("./cache.service", () => ({
  TTL: { recentScenes: 1 },
  cached: (_key: string, _ttl: number, fetcher: () => Promise<unknown>) =>
    fetcher(),
}));

import { recentScenes } from "./gibs.service";

function cmr(days: Array<[string, string]>): unknown {
  return {
    ok: true,
    json: async () => ({
      items: days.map(([day, cloud]) => ({
        umm: {
          TemporalExtent: {
            RangeDateTime: { BeginningDateTime: `${day}T10:16:50Z` },
          },
          AdditionalAttributes: [{ Name: "CLOUD_COVERAGE", Values: [cloud] }],
        },
      })),
    }),
  };
}

const NOW = new Date("2026-10-13T12:00:00Z");

describe("recentScenes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("searches both HLS products over the last 60 days and merges them", async () => {
    mocks.fetchWithResilience.mockImplementation(async (url: string) =>
      url.includes("C2021957295-LPCLOUD")
        ? cmr([
            ["2026-10-06", "10"],
            ["2026-09-26", "1"],
          ])
        : cmr([["2026-10-01", "5"]]),
    );

    const result = await recentScenes(51.0504, 13.7373, NOW);

    expect(result).toEqual({
      scenes: [
        { product: "S30", day: "2026-10-06", cloudPct: 10 },
        { product: "L30", day: "2026-10-01", cloudPct: 5 },
        { product: "S30", day: "2026-09-26", cloudPct: 1 },
      ],
      days: 60,
      maxCloud: 40,
    });
    const urls = mocks.fetchWithResilience.mock.calls.map((c) =>
      decodeURIComponent(String(c[0])),
    );
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain(
      "temporal=2026-08-15T00:00:00Z,2026-10-13T12:00:00.000Z",
    );
    expect(urls[0]).toContain("cloud_cover=0,40");
  });

  it("fails when the catalogue is unavailable", async () => {
    mocks.fetchWithResilience.mockResolvedValue({ ok: false, status: 503 });
    await expect(recentScenes(51, 13, NOW)).rejects.toThrow(/503/);
  });
});

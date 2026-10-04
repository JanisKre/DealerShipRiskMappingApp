/**
 * Roof masking must neither cache an Overpass outage as "no buildings" nor
 * block the analysis — an unreachable service falls back to no masking.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoundaryResult } from "@shared/types";

const mocks = vi.hoisted(() => ({
  cacheSet: vi.fn(),
  fetchOverpass: vi.fn(),
}));

vi.mock("./cache.service", () => ({
  cached: async <T>(key: string, ttl: number, fetcher: () => Promise<T>) => {
    const value = await fetcher();
    mocks.cacheSet(key, value, ttl);
    return value;
  },
  TTL: { buildings: 1 },
}));
vi.mock("./boundary.service", () => ({ fetchOverpass: mocks.fetchOverpass }));

import { exposureRatioForBoundary, roofCoverageRatio } from "./roof.service";

const boundary: BoundaryResult = {
  source: "fused",
  polygon: {
    type: "Polygon",
    coordinates: [
      [
        [13.0, 51.0],
        [13.001, 51.0],
        [13.001, 51.001],
        [13.0, 51.001],
        [13.0, 51.0],
      ],
    ],
  },
  areaSqm: 7_800,
  confidence: 0.6,
};

beforeEach(() => vi.clearAllMocks());

describe("roofCoverageRatio", () => {
  it("bounds the Overpass lookup with an overall budget", async () => {
    mocks.fetchOverpass.mockResolvedValue({ elements: [] });
    await roofCoverageRatio(boundary);
    expect(mocks.fetchOverpass).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ budgetMs: expect.any(Number) }),
    );
  });

  it("does not cache an unreachable service and falls back to no masking", async () => {
    mocks.fetchOverpass.mockResolvedValue(null);
    expect(await roofCoverageRatio(boundary)).toBe(0);
    expect(await exposureRatioForBoundary(boundary)).toBe(1);
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });

  it("caches a real empty answer", async () => {
    mocks.fetchOverpass.mockResolvedValue({ elements: [] });
    expect(await roofCoverageRatio(boundary)).toBe(0);
    expect(mocks.cacheSet).toHaveBeenCalledTimes(1);
  });
});

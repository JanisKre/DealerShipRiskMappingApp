/**
 * Regression cover for cache poisoning.
 *
 * The shared `cached()` helper stores whatever its fetcher returns. Routing a
 * "could not reach the service" result through it persists that as "this site
 * has no OSM features" for the full week-long TTL — so one rate-limited moment
 * blinds the boundary engine to a site long after the service recovers.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cacheGet: vi.fn(),
  cacheSet: vi.fn(),
  fetchOverpass: vi.fn(),
}));

vi.mock("../cache.service", () => ({
  cacheGet: mocks.cacheGet,
  cacheSet: mocks.cacheSet,
  cached: vi.fn(),
  TTL: { osmVector: 7 * 24 * 60 * 60 * 1000 },
}));
vi.mock("./overpass-client", () => ({ fetchOverpass: mocks.fetchOverpass }));

import { fetchOsmEvidence } from "./osm-evidence.service";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.cacheGet.mockReturnValue(null);
});

describe("fetchOsmEvidence", () => {
  it("caches a real answer", async () => {
    mocks.fetchOverpass.mockResolvedValue({
      elements: [
        {
          type: "way",
          id: 1,
          tags: { shop: "car" },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
            { lat: 1, lon: 1 },
            { lat: 0, lon: 0 },
          ],
        },
      ],
    });
    const evidence = await fetchOsmEvidence(52.5, 13.4);
    expect(evidence?.areas).toHaveLength(1);
    expect(mocks.cacheSet).toHaveBeenCalledTimes(1);
  });

  it("caches an empty answer — 'nothing mapped here' is a real result", async () => {
    mocks.fetchOverpass.mockResolvedValue({ elements: [] });
    const evidence = await fetchOsmEvidence(52.5, 13.4);
    expect(evidence).not.toBeNull();
    expect(evidence!.areas).toHaveLength(0);
    expect(mocks.cacheSet).toHaveBeenCalledTimes(1);
  });

  it("does NOT cache an unreachable service", async () => {
    mocks.fetchOverpass.mockResolvedValue(null);
    expect(await fetchOsmEvidence(52.5, 13.4)).toBeNull();
    expect(mocks.cacheSet).not.toHaveBeenCalled();
  });

  it("retries after an outage instead of serving a cached blank for a week", async () => {
    mocks.fetchOverpass.mockResolvedValueOnce(null);
    expect(await fetchOsmEvidence(52.5, 13.4)).toBeNull();

    mocks.fetchOverpass.mockResolvedValueOnce({
      elements: [
        {
          type: "way",
          id: 2,
          tags: { amenity: "parking" },
          geometry: [
            { lat: 0, lon: 0 },
            { lat: 0, lon: 1 },
            { lat: 1, lon: 1 },
            { lat: 0, lon: 0 },
          ],
        },
      ],
    });
    const second = await fetchOsmEvidence(52.5, 13.4);
    expect(second?.areas).toHaveLength(1);
    expect(mocks.fetchOverpass).toHaveBeenCalledTimes(2);
  });

  it("serves a cache hit without querying", async () => {
    mocks.cacheGet.mockReturnValue({ areas: [], lines: [], addressNodes: [] });
    await fetchOsmEvidence(52.5, 13.4);
    expect(mocks.fetchOverpass).not.toHaveBeenCalled();
  });

  it("keys the cache by rounded coordinates and radius", async () => {
    mocks.fetchOverpass.mockResolvedValue({ elements: [] });
    await fetchOsmEvidence(52.5, 13.4, 300);
    expect(mocks.cacheSet.mock.calls[0][0]).toBe(
      "osm-evidence:v1:300:52.50000,13.40000",
    );
  });
});

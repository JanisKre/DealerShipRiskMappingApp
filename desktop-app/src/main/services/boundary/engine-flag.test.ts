/**
 * Wiring tests for the boundary engine flag.
 *
 * These cover the seam between the candidate chain and the fusion engine: that
 * fusion is off unless asked for, that it wins when it produces a shape, and —
 * most importantly — that every one of its failure modes falls back to the
 * chain rather than to nothing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Polygon } from "@shared/types";

const mocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  collectEvidence: vi.fn(),
  fuseBoundary: vi.fn(),
  fromAlkis: vi.fn(),
  fetchOsmEvidence: vi.fn(),
  fromNominatimPolygon: vi.fn(),
  fromOverture: vi.fn(),
  fromAerialSurface: vi.fn(),
}));

vi.mock("../settings.service", () => ({ getSettings: mocks.getSettings }));
vi.mock("./evidence-sources", () => ({ collectEvidence: mocks.collectEvidence }));
vi.mock("../alkis.service", () => ({
  fromAlkis: mocks.fromAlkis,
  fetchParcelsNear: vi.fn(),
  PARCEL_SEARCH_RADIUS_M: 250,
}));
vi.mock("./osm-evidence.service", () => ({
  fetchOsmEvidence: mocks.fetchOsmEvidence,
}));
vi.mock("./nominatim-polygon", () => ({
  fromNominatimPolygon: mocks.fromNominatimPolygon,
}));
vi.mock("../overture.service", () => ({ fromOverture: mocks.fromOverture }));
vi.mock("../surface-boundary.service", () => ({
  fromAerialSurface: mocks.fromAerialSurface,
}));
vi.mock("../cache.service", () => ({
  cached: async <T>(_k: string, _t: number, f: () => Promise<T>) => f(),
  cacheGet: () => null,
  cacheSet: () => undefined,
  TTL: { geocode: 1, overpass: 1, buildings: 1, osmVector: 1, cadastre: 1 },
}));

import { unprojectPoint, type LonLat } from "../boundary-geometry";
import { detectBoundary } from "../boundary.service";
import * as fusion from "./fusion";

const LAT = 52.5;
const LON = 13.4;
const ANCHOR: LonLat = [LON, LAT];

function rect(halfW: number, halfH: number): LonLat[] {
  const ring = (
    [
      [-halfW, -halfH],
      [halfW, -halfH],
      [halfW, halfH],
      [-halfW, halfH],
    ] as Array<[number, number]>
  ).map((c) => unprojectPoint(c, ANCHOR));
  ring.push(ring[0]);
  return ring;
}

const FUSED_POLYGON: Polygon = { type: "Polygon", coordinates: [rect(40, 30)] };

beforeEach(() => {
  vi.restoreAllMocks();
  mocks.getSettings.mockReturnValue({});
  mocks.collectEvidence.mockResolvedValue({
    anchor: ANCHOR,
    osm: null,
    parcels: [],
    parcelsTruncated: false,
    availability: {},
  });
  mocks.fromAlkis.mockResolvedValue(null);
  mocks.fetchOsmEvidence.mockResolvedValue(null);
  mocks.fromNominatimPolygon.mockResolvedValue(null);
  mocks.fromOverture.mockResolvedValue(null);
  mocks.fromAerialSurface.mockResolvedValue(null);
});

describe("boundaryEngine flag", () => {
  it("defaults to the candidate chain and never calls fusion", async () => {
    const spy = vi.spyOn(fusion, "fuseBoundary");
    const result = await detectBoundary(LAT, LON);
    expect(result.source).toBe("synthetic");
    expect(spy).not.toHaveBeenCalled();
    expect(mocks.collectEvidence).not.toHaveBeenCalled();
    expect(result.quality?.requestedEngine).toBe("legacy");
    expect(result.quality?.usedEngine).toBe("legacy");
    expect(result.quality?.fallbackReason).toBeUndefined();
  });

  it("stays on the chain when the flag says legacy", async () => {
    mocks.getSettings.mockReturnValue({ boundaryEngine: "legacy" });
    const result = await detectBoundary(LAT, LON);
    expect(result.source).toBe("synthetic");
    expect(mocks.collectEvidence).not.toHaveBeenCalled();
    expect(result.quality?.requestedEngine).toBe("legacy");
    expect(result.quality?.usedEngine).toBe("legacy");
  });

  it("uses the fused result when the engine is enabled and succeeds", async () => {
    mocks.getSettings.mockReturnValue({ boundaryEngine: "fused" });
    vi.spyOn(fusion, "fuseBoundary").mockReturnValue({
      polygon: FUSED_POLYGON,
      areaSqm: 4_800,
      layers: [
        { layer: "osm-parking", source: "OSM", weight: 0.7, cells: 900, available: true },
      ],
      stoppedBy: "exhausted",
      confirmed: true,
      anchorShiftM: 3,
      reasons: [],
      mask: new Uint8Array(1),
      grid: {} as never,
    });

    const result = await detectBoundary(LAT, LON);
    expect(result.source).toBe("fused");
    expect(result.role).toBe("operationalLot");
    expect(result.areaSqm).toBe(4_800);
    expect(result.quality?.fusionVersion).toBe(fusion.FUSION_VERSION);
    expect(result.quality?.requestedEngine).toBe("fused");
    expect(result.quality?.usedEngine).toBe("fused");
    expect(result.quality?.fallbackReason).toBeUndefined();
    expect(result.quality?.resultVersion).toBe(fusion.FUSION_VERSION);
  });

  it("falls back to the chain when fusion finds nothing to grow from", async () => {
    mocks.getSettings.mockReturnValue({ boundaryEngine: "fused" });
    vi.spyOn(fusion, "fuseBoundary").mockReturnValue(null);
    const result = await detectBoundary(LAT, LON);
    expect(result.source).toBe("synthetic");
    expect(result.quality?.requestedEngine).toBe("fused");
    expect(result.quality?.usedEngine).toBe("legacy");
    expect(result.quality?.fallbackReason).toMatch(/no defensible evidence/i);
  });

  it("falls back to the chain when evidence collection throws", async () => {
    mocks.getSettings.mockReturnValue({ boundaryEngine: "fused" });
    mocks.collectEvidence.mockRejectedValue(new Error("overpass down"));
    const result = await detectBoundary(LAT, LON);
    expect(result.source).toBe("synthetic");
    expect(result.polygon.coordinates[0].length).toBeGreaterThan(3);
    expect(result.quality?.usedEngine).toBe("legacy");
    expect(result.quality?.fallbackReason).toMatch(/overpass down/);
  });

  it("falls back to the chain when fusion itself throws", async () => {
    mocks.getSettings.mockReturnValue({ boundaryEngine: "fused" });
    vi.spyOn(fusion, "fuseBoundary").mockImplementation(() => {
      throw new Error("bad geometry");
    });
    const result = await detectBoundary(LAT, LON);
    expect(result.source).toBe("synthetic");
    expect(result.quality?.fallbackReason).toMatch(/bad geometry/);
  });

  it("falls back to the chain when settings are unreadable", async () => {
    // Settings live in SQLite; detection must still work without it.
    mocks.getSettings.mockImplementation(() => {
      throw new Error("database unavailable");
    });
    const result = await detectBoundary(LAT, LON);
    expect(result.source).toBe("synthetic");
    expect(result.quality?.usedEngine).toBe("legacy");
    expect(result.quality?.fallbackReason).toMatch(/settings unavailable/);
  });

  it("still attaches candidates and a review verdict to a fused result", async () => {
    mocks.getSettings.mockReturnValue({ boundaryEngine: "fused" });
    vi.spyOn(fusion, "fuseBoundary").mockReturnValue({
      polygon: FUSED_POLYGON,
      areaSqm: 4_800,
      layers: [],
      stoppedBy: "areaCap",
      confirmed: false,
      anchorShiftM: 0,
      reasons: ["growth stopped by the areaCap"],
      mask: new Uint8Array(1),
      grid: {} as never,
    });

    const result = await detectBoundary(LAT, LON);
    expect(result.candidates?.length).toBeGreaterThan(0);
    // A truncated, unconfirmed site must be flagged however it was produced.
    expect(result.reviewRequired).toBe(true);
    expect(result.quality?.stoppedBy).toBe("areaCap");
  });
});

describe("source agreement independence", () => {
  it("does not let two OSM readings corroborate each other", async () => {
    // fromOsm and fromOsmBuildings now read one Overpass response, and
    // nominatim-polygon reads the same dataset again. Overlapping geometry
    // between them is one opinion, not three.
    const overlapping = rect(35, 28);
    mocks.fetchOsmEvidence.mockResolvedValue({
      areas: [
        { kind: "parking", ring: overlapping, tags: {}, osmType: "way", osmId: 1 },
        { kind: "building", ring: overlapping, tags: {}, osmType: "way", osmId: 2 },
      ],
      lines: [],
      addressNodes: [],
    });

    const result = await detectBoundary(LAT, LON);
    expect(result.source).toBe("osm");
    expect(result.quality?.sourceAgreement).toBe(0);
  });

  it("counts a cadastral parcel as genuine corroboration", async () => {
    const shared = rect(35, 28);
    mocks.fetchOsmEvidence.mockResolvedValue({
      areas: [
        { kind: "parking", ring: shared, tags: {}, osmType: "way", osmId: 1 },
      ],
      lines: [],
      addressNodes: [],
    });
    mocks.fromAlkis.mockResolvedValue({
      source: "alkis",
      role: "parcel",
      provider: "alkis:Berlin",
      polygon: { type: "Polygon", coordinates: [shared] },
      areaSqm: 3_920,
      confidence: 0.9,
    });

    const result = await detectBoundary(LAT, LON);
    expect(result.quality?.sourceAgreement).toBeGreaterThan(0.8);
  });
});

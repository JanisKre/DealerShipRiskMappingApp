import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LonLat } from "./boundary-geometry";
import type { ParcelLookup } from "./alkis.service";
import { ringAreaSqm, unprojectPoint } from "./boundary-geometry";

const mocks = vi.hoisted(() => ({
  fetchParcelsNear: vi.fn(),
  osmEvidenceBy: vi.fn(),
}));

vi.mock("./alkis.service", () => ({
  fetchParcelsNear: mocks.fetchParcelsNear,
  PARCEL_SEARCH_RADIUS_M: 250,
}));
vi.mock("./boundary/osm-evidence.service", () => ({
  osmEvidenceBy: mocks.osmEvidenceBy,
}));
vi.mock("./detection/roof-mask.service", () => ({
  officialBuildingsBy: async () => ({
    buildings: [],
    state: null,
    truncated: false,
  }),
}));

import {
  detectBoundary,
  OFF_SITE_MARKER_RADIUS_M,
  SYNTHETIC_BOUNDARY_RADIUS_M,
  syntheticFallbackBoundary,
} from "./boundary.service";

const LAT = 51.0133;
const LON = 13.792;
const ANCHOR: LonLat = [LON, LAT];

function at(east: number, north: number): LonLat {
  return unprojectPoint([east, north], ANCHOR);
}

function rect(
  west: number,
  south: number,
  east: number,
  north: number,
): LonLat[] {
  const ring = [
    at(west, south),
    at(east, south),
    at(east, north),
    at(west, north),
  ];
  ring.push(ring[0]);
  return ring;
}

function cars(
  west: number,
  south: number,
  east: number,
  north: number,
): LonLat[] {
  const points: LonLat[] = [];
  for (let x = west + 2.5; x < east; x += 5) {
    for (let y = south + 2.5; y < north; y += 5) points.push(at(x, y));
  }
  return points;
}

function parcels(...rings: LonLat[][]): ParcelLookup {
  return {
    parcels: rings.map((ring) => ({
      ring,
      areaSqm: ringAreaSqm(ring),
      state: "Sachsen",
    })),
    state: "Sachsen",
    truncated: false,
    reachable: true,
    containsAnchor: true,
    status: "success",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.fetchParcelsNear.mockResolvedValue(parcels());
  mocks.osmEvidenceBy.mockResolvedValue({ evidence: null, status: "pending" });
});

describe("detectBoundary", () => {
  it("builds the lot from the parcels holding the vehicles", async () => {
    mocks.fetchParcelsNear.mockResolvedValue(
      parcels(rect(-12, -12, 12, 12), rect(-52, -12, -12, 12)),
    );
    const result = await detectBoundary(
      LAT,
      LON,
      "Autopark",
      undefined,
      undefined,
      [...cars(-50, -10, -14, 10), at(0, 5), at(5, 5), at(-5, 5)],
    );
    expect(result.quality?.cascadeStage).toBe(1);
    expect(result.provider).toBe("alkis-vehicle-parcels");
    expect(result.reviewRequired).toBe(false);
    expect(result.candidates?.[0].provider).toBe("alkis-vehicle-parcels");
  });

  it("passes the OSM deadline through and never needs OSM", async () => {
    await detectBoundary(LAT, LON, undefined, undefined, undefined, null, {
      osmDeadline: 123,
    });
    expect(mocks.osmEvidenceBy).toHaveBeenCalledWith(LAT, LON, 123);
  });

  it("falls back to the circle and says why", async () => {
    mocks.fetchParcelsNear.mockRejectedValue(new Error("offline"));
    const result = await detectBoundary(LAT, LON);
    expect(result.source).toBe("synthetic");
    expect(result.quality?.cascadeStage).toBe(5);
    expect(result.reviewRequired).toBe(true);
    expect(result.evidence?.fallbackUsed).toBe(true);
    expect(result.quality?.reasons).toEqual(
      expect.arrayContaining([
        "stage 5: synthetic circle around the point",
        "no vehicle detection — re-analyse with a model",
        "cadastre service unreachable — re-analyse when online",
      ]),
    );
  });

  it("draws only a small marker at a point in a wood", async () => {
    mocks.fetchParcelsNear.mockRejectedValue(new Error("offline"));
    const r = 0.01;
    const forest = {
      west: LON - r,
      south: LAT - r,
      east: LON + r,
      north: LAT + r,
      width: 50,
      height: 50,
      cells: new Uint8Array(2500).fill(1),
    };
    const result = await detectBoundary(
      LAT,
      LON,
      undefined,
      undefined,
      undefined,
      [],
      { vegetation: forest },
    );
    expect(result.source).toBe("synthetic");
    expect(result.quality?.reviewFlags).toContain("pointOffSite");
    const full = syntheticFallbackBoundary(LAT, LON).areaSqm;
    expect(result.areaSqm).toBeLessThan(full / 20);
    expect(result.quality?.reasons).toContain(
      `stage 5: ${OFF_SITE_MARKER_RADIUS_M} m marker at the point (off the site)`,
    );
  });
});

describe("synthetic fallback boundary", () => {
  it("creates an octagon with the calibrated radius", () => {
    const boundary = syntheticFallbackBoundary(51, 10);
    const ring = boundary.polygon.coordinates[0];

    expect(boundary.source).toBe("synthetic");
    expect(ring).toHaveLength(9); // eight vertices plus the closing point
    expect(ring[0]).toEqual(ring.at(-1));
    // Regular octagon: 2·√2·r² with r = 160 m.
    expect(boundary.areaSqm).toBeGreaterThan(70_000);
    expect(boundary.areaSqm).toBeLessThan(75_000);
    expect(SYNTHETIC_BOUNDARY_RADIUS_M).toBe(160);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoundaryResult, DetectionResult } from "@shared/types";

const mocks = vi.hoisted(() => ({
  detectBoundary: vi.fn(),
  detectVehiclesInContext: vi.fn(),
  detectVehicles: vi.fn(),
  maskRoofDetections: vi.fn(),
  geocodeCandidates: vi.fn(),
  officialHouseCoordinate: vi.fn(),
  aerialImageForContext: vi.fn(),
  osmEvidenceBy: vi.fn(),
  websiteFromEvidence: vi.fn(),
  order: [] as string[],
}));

vi.mock("./boundary.service", () => ({
  detectBoundary: (...args: unknown[]) => {
    mocks.order.push("boundary");
    return mocks.detectBoundary(...args);
  },
}));
vi.mock("./detection.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./detection.service")>();
  return {
    attachImageryProvenance: (d: DetectionResult) => d,
    filterDetectionToBoundary: actual.filterDetectionToBoundary,
    detectVehicles: mocks.detectVehicles,
    detectVehiclesInContext: (...args: unknown[]) => {
      mocks.order.push("detect");
      return mocks.detectVehiclesInContext(...args);
    },
  };
});
vi.mock("./detection/roof-mask.service", () => ({
  maskRoofDetections: mocks.maskRoofDetections,
  OFFICIAL_BUILDINGS_WAIT_MS: 5000,
}));
vi.mock("./house-coordinates.service", () => ({
  officialHouseCoordinate: mocks.officialHouseCoordinate,
}));
vi.mock("./alkis-buildings.service", () => ({
  fetchOfficialBuildings: () =>
    Promise.resolve({ buildings: [], state: null, truncated: false }),
}));
vi.mock("./geocoding.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./geocoding.service")>();
  return { ...actual, geocodeCandidates: mocks.geocodeCandidates };
});
vi.mock("./tiles.service", () => ({
  aerialImageForContext: mocks.aerialImageForContext,
  CONTEXT_CAPTURE_RADIUS_M: 125,
  WIDE_CONTEXT_CAPTURE_RADIUS_M: 190,
}));
vi.mock("./boundary/osm-evidence.service", () => ({
  osmEvidenceBy: mocks.osmEvidenceBy,
}));
vi.mock("./osmDetails.service", () => ({
  websiteFromEvidence: mocks.websiteFromEvidence,
}));
vi.mock("./natcat.service", () => ({ resolveNatCat: async () => undefined }));
vi.mock("./risk.service", () => ({ scoreRisk: async () => ({}) }));

import {
  analyzeDealership,
  lotReachesImageEdge,
  OSM_WAIT_MS,
} from "./analyze.service";

const LAT = 51.05;
const LON = 13.7;

function square(half: number): BoundaryResult["polygon"] {
  return {
    type: "Polygon",
    coordinates: [
      [
        [LON - half, LAT - half],
        [LON + half, LAT - half],
        [LON + half, LAT + half],
        [LON - half, LAT + half],
        [LON - half, LAT - half],
      ],
    ],
  };
}

const boundary: BoundaryResult = {
  polygon: square(0.0002),
  source: "fused",
  areaSqm: 1000,
  confidence: 0.8,
  quality: { reasons: [] } as unknown as BoundaryResult["quality"],
} as BoundaryResult;

const detection = {
  vehicleCount: 2,
  boxes: [
    { x: 0, y: 0, w: 0.01, h: 0.01, score: 0.9, lon: LON, lat: LAT },
    // Far outside the boundary: evidence, but not counted.
    { x: 0, y: 0, w: 0.01, h: 0.01, score: 0.7, lon: LON + 0.01, lat: LAT },
  ],
} as unknown as DetectionResult;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.order.length = 0;
  mocks.aerialImageForContext.mockResolvedValue({ imagery: undefined });
  mocks.detectVehiclesInContext.mockResolvedValue(detection);
  mocks.maskRoofDetections.mockImplementation(async (d: DetectionResult) => d);
  mocks.detectBoundary.mockResolvedValue(boundary);
  mocks.osmEvidenceBy.mockResolvedValue({ evidence: null, status: "pending" });
  mocks.websiteFromEvidence.mockReturnValue(undefined);
  mocks.officialHouseCoordinate.mockResolvedValue(null);
});

const record = {
  id: "1",
  name: "Autohaus Test",
  lat: LAT,
  lon: LON,
} as Parameters<typeof analyzeDealership>[0];

describe("analyzeDealership", () => {
  it("detects vehicles once, before the boundary, and passes them as evidence", async () => {
    const result = await analyzeDealership({
      id: "1",
      name: "Autohaus Test",
      lat: LAT,
      lon: LON,
    } as Parameters<typeof analyzeDealership>[0]);

    expect(mocks.order).toEqual(["detect", "boundary"]);
    expect(mocks.detectVehiclesInContext).toHaveBeenCalledTimes(1);
    expect(mocks.detectVehicles).not.toHaveBeenCalled();
    const vehicles = mocks.detectBoundary.mock.calls[0][5];
    expect(vehicles).toEqual([
      [LON, LAT],
      [LON + 0.01, LAT],
    ]);
    // The boundary still clips the count afterwards.
    expect(result.detection?.boxes).toHaveLength(1);
  });

  it("passes no vehicle evidence when the detector produced no boxes", async () => {
    mocks.detectVehiclesInContext.mockResolvedValue({ vehicleCount: 0 });
    mocks.detectVehicles.mockResolvedValue({ vehicleCount: 3 });
    await analyzeDealership({
      id: "1",
      name: "Autohaus Test",
      lat: LAT,
      lon: LON,
    } as Parameters<typeof analyzeDealership>[0]);
    expect(mocks.detectBoundary.mock.calls[0][5]).toBeNull();
  });

  it("anchors on the scored geocoding hit and flags ambiguity for review", async () => {
    mocks.geocodeCandidates.mockImplementation(async (query: string) =>
      query.startsWith("Autohaus")
        ? []
        : [
            { label: "a", lat: LAT, lon: LON, postcode: "01159" },
            { label: "b", lat: LAT + 0.01, lon: LON, postcode: "01159" },
          ],
    );
    const result = await analyzeDealership({
      id: "1",
      name: "Autohaus Test",
      address: "Industriestraße 12, 01159 Dresden",
    } as Parameters<typeof analyzeDealership>[0]);

    expect(mocks.geocodeCandidates).toHaveBeenCalledTimes(2);
    expect(result.lat).toBe(LAT);
    expect(result.boundary?.reviewRequired).toBe(true);
    expect(result.boundary?.quality?.reasons.join(" ")).toMatch(
      /geocoding ambiguous/,
    );
  });

  it("moves the anchor to the official house coordinate and says so", async () => {
    mocks.geocodeCandidates.mockImplementation(async (query: string) =>
      query.startsWith("Autohaus")
        ? []
        : [{ label: "street", lat: LAT, lon: LON, postcode: "01159" }],
    );
    mocks.officialHouseCoordinate.mockResolvedValue({
      lat: LAT + 0.001,
      lon: LON,
      state: "Sachsen",
    });
    mocks.detectBoundary.mockResolvedValue({
      ...boundary,
      evidence: {
        source: "test",
        retrievedAt: "2026-11-11T00:00:00Z",
        method: "parcel union",
        confidence: 0.8,
        fallbackUsed: false,
        limitations: [],
      },
    });
    const result = await analyzeDealership({
      id: "1",
      name: "Autohaus Test",
      address: "Industriestraße 12, 01159 Dresden",
    } as Parameters<typeof analyzeDealership>[0]);

    expect(result.lat).toBe(LAT + 0.001);
    expect(result.boundary?.evidence?.method).toBe(
      "parcel union; anchor: official house coordinate (ALKIS Sachsen)",
    );
  });

  it("keeps the dealership's own POI over a house coordinate", async () => {
    mocks.geocodeCandidates.mockImplementation(async (query: string) =>
      query.startsWith("Autohaus")
        ? [
            {
              label: "poi",
              lat: LAT,
              lon: LON,
              name: "Autohaus Test",
              category: "shop",
              type: "car",
              postcode: "01159",
            },
          ]
        : [],
    );
    const result = await analyzeDealership({
      id: "1",
      name: "Autohaus Test",
      address: "Industriestraße 12, 01159 Dresden",
    } as Parameters<typeof analyzeDealership>[0]);

    expect(mocks.officialHouseCoordinate).not.toHaveBeenCalled();
    expect(result.lat).toBe(LAT);
  });

  it("never waits for OpenStreetMap", async () => {
    const before = Date.now();
    await analyzeDealership(record);
    const [, , , , , , options] = mocks.detectBoundary.mock.calls[0];
    expect(OSM_WAIT_MS).toBe(0);
    expect(options.osmDeadline).toBeGreaterThanOrEqual(before);
    expect(options.osmDeadline).toBeLessThanOrEqual(Date.now());
  });

  it("gives every OSM consumer the same deadline", async () => {
    mocks.osmEvidenceBy.mockResolvedValue({
      evidence: { areas: [], lines: [], addressNodes: [], namedPlaces: [] },
      status: "answered",
    });
    mocks.websiteFromEvidence.mockReturnValue("https://autohaus-test.de/");
    const result = await analyzeDealership(record);

    const roofDeadline = mocks.maskRoofDetections.mock.calls[0][3];
    expect(mocks.detectBoundary.mock.calls[0][6].osmDeadline).toBe(
      roofDeadline,
    );
    expect(mocks.osmEvidenceBy).toHaveBeenCalledWith(LAT, LON, roofDeadline);
    expect(result.website).toBe("https://autohaus-test.de/");
    expect(result.websiteSource).toBe("osm");
  });

  it("does not look up a website the record already has", async () => {
    await analyzeDealership({ ...record, website: "https://known.de/" });
    expect(mocks.websiteFromEvidence).not.toHaveBeenCalled();
  });
});

describe("cascade v3 analysis steps", () => {
  const cascadeBoundary = (stage: number): BoundaryResult =>
    ({
      ...boundary,
      source: "alkis",
      quality: {
        reasons: [],
        usedEngine: "cascade",
        cascadeStage: stage,
        pointRelation: "inside",
      },
    }) as unknown as BoundaryResult;

  it("gives roof mask and boundary the same bounded wait for official footprints", async () => {
    const before = Date.now();
    await analyzeDealership(record);
    const buildingsDeadline = mocks.maskRoofDetections.mock.calls[0][4];
    expect(buildingsDeadline).toBeGreaterThan(before);
    expect(mocks.detectBoundary.mock.calls[0][6].buildingsDeadline).toBe(
      buildingsDeadline,
    );
  });

  it("sends a boundary on winter imagery to review and says why", async () => {
    mocks.detectBoundary.mockResolvedValue(cascadeBoundary(1));
    mocks.aerialImageForContext.mockResolvedValue({
      imagery: { chosen: { capturedAt: "2025-02-01" } },
    });
    const result = await analyzeDealership(record);
    expect(result.boundary?.quality?.reviewFlags).toEqual(["winterImagery"]);
    expect(result.boundary?.reviewRequired).toBe(true);
  });

  it("does not flag spring imagery", async () => {
    mocks.detectBoundary.mockResolvedValue(cascadeBoundary(1));
    mocks.aerialImageForContext.mockResolvedValue({
      imagery: { chosen: { capturedAt: "2024-04-12" } },
    });
    const result = await analyzeDealership(record);
    expect(result.boundary?.quality?.reviewFlags).toBeUndefined();
  });

  it("captures a wider image when the lot reaches the edge of the first", async () => {
    // Context bbox ±0.0001° around the point; the boundary covers all of it,
    // and three vehicles stand right at its eastern edge.
    const bbox: [number, number, number, number] = [
      LON - 0.0001,
      LAT - 0.0001,
      LON + 0.0001,
      LAT + 0.0001,
    ];
    mocks.aerialImageForContext.mockResolvedValue({ bbox, imagery: undefined });
    mocks.detectBoundary.mockResolvedValue(cascadeBoundary(1));
    mocks.detectVehiclesInContext.mockResolvedValue({
      vehicleCount: 3,
      boxes: [0, 1, 2].map((i) => ({
        x: 0,
        y: 0,
        w: 0.01,
        h: 0.01,
        score: 0.9,
        lon: LON + 0.00009,
        lat: LAT + i * 0.00002,
      })),
    });
    await analyzeDealership(record);
    const radii = mocks.aerialImageForContext.mock.calls.map((call) => call[3]);
    expect(radii).toEqual([125, 190]);
  });
});

describe("lotReachesImageEdge", () => {
  const image = {
    bbox: [LON - 0.002, LAT - 0.002, LON + 0.002, LAT + 0.002] as [
      number,
      number,
      number,
      number,
    ],
  };
  const stage1 = {
    ...boundary,
    polygon: square(0.0019),
    quality: { reasons: [], cascadeStage: 1 },
  } as unknown as BoundaryResult;
  const edgeCars = (n: number): DetectionResult =>
    ({
      boxes: Array.from({ length: n }, (_, i) => ({
        x: 0,
        y: 0,
        w: 0,
        h: 0,
        score: 1,
        lon: LON + 0.00185,
        lat: LAT + i * 0.0001,
      })),
    }) as unknown as DetectionResult;

  it("needs three lot vehicles at the edge", () => {
    expect(lotReachesImageEdge(stage1, edgeCars(3), image)).toBe(true);
    expect(lotReachesImageEdge(stage1, edgeCars(2), image)).toBe(false);
  });

  it("ignores circles and bare parcels", () => {
    const circle = {
      ...stage1,
      quality: { reasons: [], cascadeStage: 5 },
    } as unknown as BoundaryResult;
    expect(lotReachesImageEdge(circle, edgeCars(5), image)).toBe(false);
  });
});

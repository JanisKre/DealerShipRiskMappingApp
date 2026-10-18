import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BoundaryResult, DetectionResult } from "@shared/types";

const mocks = vi.hoisted(() => ({
  detectBoundary: vi.fn(),
  detectVehiclesInContext: vi.fn(),
  detectVehicles: vi.fn(),
  maskRoofDetections: vi.fn(),
  geocodeCandidates: vi.fn(),
  aerialImageForContext: vi.fn(),
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
}));
vi.mock("./geocoding.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./geocoding.service")>();
  return { ...actual, geocodeCandidates: mocks.geocodeCandidates };
});
vi.mock("./tiles.service", () => ({
  aerialImageForContext: mocks.aerialImageForContext,
}));
vi.mock("./osmDetails.service", () => ({
  getOsmDetails: async () => ({}),
}));
vi.mock("./natcat.service", () => ({ resolveNatCat: async () => undefined }));
vi.mock("./risk.service", () => ({ scoreRisk: async () => ({}) }));

import { analyzeDealership } from "./analyze.service";

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
});

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
      { point: [LON, LAT], score: 0.9 },
      { point: [LON + 0.01, LAT], score: 0.7 },
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
    expect(mocks.detectBoundary.mock.calls[0][5]).toBeUndefined();
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
});

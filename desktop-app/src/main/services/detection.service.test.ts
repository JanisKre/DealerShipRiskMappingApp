import { describe, expect, it, vi } from "vitest";
import type { BoundaryResult, DetectionResult } from "@shared/types";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/dealership-risk-test"),
    getAppPath: vi.fn(() => "/tmp/dealership-risk-test"),
  },
  utilityProcess: { fork: vi.fn() },
}));

import {
  detectVehiclesInContext,
  filterDetectionToBoundary,
  StubVehicleDetector,
} from "./detection.service";

describe("StubVehicleDetector", () => {
  it("returns an area-based fallback with low confidence", async () => {
    const detector = new StubVehicleDetector();
    const boundary = {
      areaSqm: 1_250,
    } as BoundaryResult;

    const result = await detector.detect(
      { rgba: null, width: 0, height: 0, bbox: [7, 51, 7.01, 51.01] },
      boundary,
    );

    expect(result.model).toBe("stub-area-heuristic");
    expect(result.vehicleCount).toBe(50);
    expect(result.confidence).toBe(0.3);
    expect(result.classCounts).toEqual({ car: 50, van: 0, truck: 0, bus: 0 });
    expect(result.evidence?.fallbackUsed).toBe(true);
  });

  it("returns zero vehicles when no boundary is available", async () => {
    const result = await new StubVehicleDetector().detect({
      rgba: null,
      width: 0,
      height: 0,
      bbox: [0, 0, 1, 1],
    });

    expect(result.vehicleCount).toBe(0);
    expect(result.confidence).toBe(0.1);
  });
});

describe("detectVehiclesInContext", () => {
  it("detects without clipping to a boundary (stub falls back to zero, not an area estimate)", async () => {
    // With no model installed in the test environment, getDetector() resolves
    // to the stub, whose count comes only from `boundary.areaSqm` — omitting
    // the boundary here is the point: a context pass must not itself decide
    // the site's shape.
    const result = await detectVehiclesInContext({
      rgba: null,
      width: 0,
      height: 0,
      bbox: [7, 51, 7.01, 51.01],
    });
    expect(result.vehicleCount).toBe(0);
    expect(result.boxes).toBeUndefined();
  });
});

describe("filterDetectionToBoundary", () => {
  const square = (halfDeg: number): BoundaryResult["polygon"] => ({
    type: "Polygon",
    coordinates: [
      [
        [13.4 - halfDeg, 52.5 - halfDeg],
        [13.4 + halfDeg, 52.5 - halfDeg],
        [13.4 + halfDeg, 52.5 + halfDeg],
        [13.4 - halfDeg, 52.5 + halfDeg],
        [13.4 - halfDeg, 52.5 - halfDeg],
      ],
    ],
  });

  const boundary = { polygon: square(0.001) } as BoundaryResult;

  const contextDetection: DetectionResult = {
    vehicleCount: 3,
    confidence: 0.8,
    model: "test-model",
    classCounts: { car: 3, van: 0, truck: 0, bus: 0 },
    boxes: [
      { x: 0.1, y: 0.1, w: 0.02, h: 0.02, score: 0.9, lon: 13.4, lat: 52.5 }, // inside
      { x: 0.2, y: 0.2, w: 0.02, h: 0.02, score: 0.7, lon: 13.4005, lat: 52.5005 }, // inside
      { x: 0.3, y: 0.3, w: 0.02, h: 0.02, score: 0.6, lon: 13.5, lat: 52.6 }, // far outside
    ],
    evidence: {
      source: "test",
      retrievedAt: "2026-01-01T00:00:00Z",
      method: "test",
      confidence: 0.8,
      fallbackUsed: false,
      limitations: [],
    },
  };

  it("re-clips boxes to the boundary without touching the source detection", () => {
    const filtered = filterDetectionToBoundary(contextDetection, boundary);
    expect(filtered).not.toBeNull();
    expect(filtered!.vehicleCount).toBe(2);
    expect(filtered!.boxes).toHaveLength(2);
    expect(filtered!.classCounts).toEqual({ car: 2, van: 0, truck: 0, bus: 0 });
    expect(filtered!.confidence).toBeCloseTo((0.9 + 0.7) / 2, 6);
    expect(filtered!.evidence?.confidence).toBeCloseTo((0.9 + 0.7) / 2, 6);
    // The source detection is untouched — this only produces a new view.
    expect(contextDetection.vehicleCount).toBe(3);
  });

  it("shrinks to zero when a tighter boundary excludes every box", () => {
    const tinyBoundary = { polygon: square(0.00001) } as BoundaryResult;
    const filtered = filterDetectionToBoundary(
      { ...contextDetection, boxes: [contextDetection.boxes![2]] },
      tinyBoundary,
    );
    expect(filtered!.vehicleCount).toBe(0);
    expect(filtered!.confidence).toBe(0);
  });

  it("returns null when the source has no per-vehicle geometry (stub fallback)", () => {
    const stubResult: DetectionResult = {
      vehicleCount: 5,
      confidence: 0.3,
      model: "stub-area-heuristic",
      classCounts: { car: 5, van: 0, truck: 0, bus: 0 },
    };
    expect(filterDetectionToBoundary(stubResult, boundary)).toBeNull();
  });

  it("ignores boxes without georeferencing rather than crashing", () => {
    const filtered = filterDetectionToBoundary(
      {
        ...contextDetection,
        boxes: [{ x: 0, y: 0, w: 0.01, h: 0.01, score: 0.5 }],
      },
      boundary,
    );
    expect(filtered!.vehicleCount).toBe(0);
  });
});

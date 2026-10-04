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
  attachImageryProvenance,
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
      {
        x: 0.2,
        y: 0.2,
        w: 0.02,
        h: 0.02,
        score: 0.7,
        lon: 13.4005,
        lat: 52.5005,
      }, // inside
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

describe("attachImageryProvenance", () => {
  const imagery = {
    mode: "auto" as const,
    chosen: {
      id: "dop:NW",
      kind: "state-dop" as const,
      label: "DOP10 Nordrhein-Westfalen",
      capturedAt: "2025-04-07",
      dateSource: "bkg-flight-index" as const,
      resolutionM: 0.1,
      zoom: 20,
      attribution: "© GeoBasis-DE / NRW (2026), dl-de/zero-2-0",
      state: "NW" as const,
    },
    reason: "sharper-within-tolerance" as const,
    candidates: [],
    toleranceDays: 183,
    resolvedAt: "2026-10-04T00:00:00.000Z",
  };
  const base: DetectionResult = {
    vehicleCount: 3,
    confidence: 0.8,
    model: "yolo",
    evidence: {
      source: "YOLOv26 ONNX",
      retrievedAt: "2026-10-04T00:00:00.000Z",
      method: "m",
      confidence: 0.8,
      fallbackUsed: false,
      limitations: ["Accuracy depends on imagery resolution and capture date"],
    },
  };

  it("stores the selection and a dated evidence line", () => {
    const result = attachImageryProvenance(base, imagery);
    expect(result.imagery).toBe(imagery);
    expect(result.evidence?.limitations).toEqual([
      "Accuracy depends on imagery resolution and capture date",
      "Vehicles counted on DOP10 Nordrhein-Westfalen (2025-04-07, 0.1 m, z20; selection: sharper-within-tolerance)",
    ]);
  });

  it("replaces rather than duplicates the line on re-analysis", () => {
    const twice = attachImageryProvenance(
      attachImageryProvenance(base, imagery),
      imagery,
    );
    expect(
      twice.evidence?.limitations.filter((l) => l.startsWith("Vehicles counted on")),
    ).toHaveLength(1);
  });

  it("leaves detections without a capture record untouched", () => {
    expect(attachImageryProvenance(base, undefined)).toBe(base);
  });
});

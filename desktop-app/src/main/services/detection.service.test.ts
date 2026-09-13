import { describe, expect, it, vi } from "vitest";
import type { BoundaryResult } from "@shared/types";

vi.mock("electron", () => ({
  app: {
    getPath: vi.fn(() => "/tmp/dealership-risk-test"),
    getAppPath: vi.fn(() => "/tmp/dealership-risk-test"),
  },
  utilityProcess: { fork: vi.fn() },
}));

import { StubVehicleDetector } from "./detection.service";

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

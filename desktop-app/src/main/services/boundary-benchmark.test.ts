import { describe, expect, it } from "vitest";
import type { Polygon } from "@shared/types";
import {
  evaluateBoundaryBenchmark,
  type BoundaryBenchmarkSample,
} from "./boundary-benchmark";

const polygon = (offset = 0): Polygon => ({
  type: "Polygon",
  coordinates: [
    [
      [10 + offset, 51 + offset],
      [10.001 + offset, 51 + offset],
      [10.001 + offset, 51.001 + offset],
      [10 + offset, 51.001 + offset],
      [10 + offset, 51 + offset],
    ],
  ],
});

describe("boundary benchmark", () => {
  it("reports high overlap for a near-identical prediction", () => {
    const sample: BoundaryBenchmarkSample = {
      id: "one",
      reference: polygon(),
      predicted: polygon(0.00001),
      predictedConfidence: 0.9,
    };
    const result = evaluateBoundaryBenchmark([sample]);
    expect(result.meanIoU).toBeGreaterThan(0.9);
    expect(result.meanCoverage).toBeGreaterThan(0.9);
    expect(result.coverage90Rate).toBe(1);
  });

  it("returns an empty, serializable result for no samples", () => {
    const result = evaluateBoundaryBenchmark([]);
    expect(result.evaluatedSamples).toBe(0);
    expect(result.calibration.bins).toHaveLength(10);
  });
});

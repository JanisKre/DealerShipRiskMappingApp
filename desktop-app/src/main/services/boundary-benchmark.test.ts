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

  it("tells a result that is too large from one that is too small", () => {
    // 0.001° of longitude at 51° N is about 70 m, of latitude about 111 m.
    const box = (east: number): Polygon => ({
      type: "Polygon",
      coordinates: [
        [
          [10, 51],
          [10 + east, 51],
          [10 + east, 51.001],
          [10, 51.001],
          [10, 51],
        ],
      ],
    });
    // Twice the reference: nothing missing, as much again in excess.
    const tooLarge = evaluateBoundaryBenchmark([
      { id: "large", reference: box(0.001), predicted: box(0.002) },
    ]);
    expect(tooLarge.meanCoverage).toBeCloseTo(1, 2);
    expect(tooLarge.meanExcessShare).toBeCloseTo(1, 1);
    // Half the reference: half missing, no excess. Both have an IoU of 0.5.
    const tooSmall = evaluateBoundaryBenchmark([
      { id: "small", reference: box(0.002), predicted: box(0.001) },
    ]);
    expect(tooSmall.meanCoverage).toBeCloseTo(0.5, 1);
    expect(tooSmall.meanExcessShare).toBeCloseTo(0, 2);
    expect(tooLarge.meanIoU).toBeCloseTo(tooSmall.meanIoU, 1);
  });

  it("returns an empty, serializable result for no samples", () => {
    const result = evaluateBoundaryBenchmark([]);
    expect(result.evaluatedSamples).toBe(0);
    expect(result.meanExcessShare).toBe(0);
    expect(result.calibration.bins).toHaveLength(10);
  });
});

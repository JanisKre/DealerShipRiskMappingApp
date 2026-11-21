import { describe, expect, it } from "vitest";
import {
  bootstrapMaeInterval,
  countMosaicLabels,
  evaluateDetectionBenchmark,
  type TileLabel,
} from "./detection-benchmark";

describe("detection benchmark", () => {
  it("calculates count error, bias, tolerance, and class MAE", () => {
    const result = evaluateDetectionBenchmark([
      {
        id: "a",
        expectedCount: 10,
        predictedCount: 11,
        expectedClassCounts: { car: 10 },
        predictedClassCounts: { car: 11 },
      },
      {
        id: "b",
        expectedCount: 20,
        predictedCount: 17,
        expectedClassCounts: { car: 18, van: 2 },
        predictedClassCounts: { car: 15, van: 2 },
      },
    ]);

    expect(result.countMae).toBe(2);
    expect(result.countBias).toBe(-1);
    expect(result.within10PctRate).toBe(0.5);
    expect(result.classMae.car).toBe(2);
    expect(result.classMae.van).toBeUndefined();
  });

  it("handles an empty benchmark explicitly", () => {
    expect(evaluateDetectionBenchmark([]).evaluatedSamples).toBe(0);
  });
});

/** An axis-aligned box as OBB corners, in tile coordinates. */
function box(
  row: number,
  col: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
): TileLabel {
  return { row, col, corners: [x0, y0, x1, y0, x1, y1, x0, y1] };
}

describe("ground truth of a tile mosaic", () => {
  it("counts a vehicle cut by a vertical seam once", () => {
    expect(
      countMosaicLabels([
        box(0, 0, 0.97, 0.4, 1, 0.45),
        box(0, 1, 0, 0.4, 0.02, 0.45),
      ]),
    ).toBe(1);
  });

  it("counts a vehicle cut by a horizontal seam once", () => {
    expect(
      countMosaicLabels([
        box(0, 2, 0.3, 0.98, 0.34, 1),
        box(1, 2, 0.3, 0, 0.34, 0.05),
      ]),
    ).toBe(1);
  });

  it("keeps vehicles that only sit near the same seam apart", () => {
    expect(
      countMosaicLabels([
        // Different rows along the seam: two vehicles.
        box(0, 0, 0.97, 0.1, 1, 0.15),
        box(0, 1, 0, 0.6, 0.02, 0.65),
        // Not at the seam at all.
        box(0, 1, 0.5, 0.5, 0.55, 0.55),
        // Same place in a tile that is not a neighbour.
        box(2, 2, 0, 0.1, 0.02, 0.15),
      ]),
    ).toBe(4);
  });

  it("joins a vehicle split over four tiles at a corner", () => {
    expect(
      countMosaicLabels([
        box(0, 0, 0.98, 0.98, 1, 1),
        box(0, 1, 0, 0.98, 0.02, 1),
        box(1, 0, 0.98, 0, 1, 0.02),
        box(1, 1, 0, 0, 0.02, 0.02),
      ]),
    ).toBe(1);
  });
});

describe("bootstrap interval of the MAE", () => {
  const samples = Array.from({ length: 20 }, (_, i) => ({
    id: `s${i}`,
    expectedCount: 50,
    predictedCount: 50 + (i % 5) * 2 - 4,
  }));

  it("is reproducible and contains the point estimate", () => {
    const first = bootstrapMaeInterval(samples);
    expect(bootstrapMaeInterval(samples)).toEqual(first);
    const mae = evaluateDetectionBenchmark(samples).countMae;
    expect(first.low).toBeLessThanOrEqual(mae);
    expect(first.high).toBeGreaterThanOrEqual(mae);
    expect(first.high).toBeGreaterThan(first.low);
  });

  it("is a point when every site has the same error", () => {
    const same = samples.map((s) => ({ ...s, predictedCount: 53 }));
    expect(bootstrapMaeInterval(same)).toEqual({ low: 3, high: 3 });
  });
});

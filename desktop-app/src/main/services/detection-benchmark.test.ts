import { describe, expect, it } from "vitest";
import { evaluateDetectionBenchmark } from "./detection-benchmark";

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

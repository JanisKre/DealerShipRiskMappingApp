import type {
  ClassCounts,
  DetectionEvaluation,
  DetectionResult,
} from "@shared/types";

export interface DetectionBenchmarkSample {
  id: string;
  expectedCount: number;
  predictedCount: number;
  expectedClassCounts?: Partial<ClassCounts>;
  predictedClassCounts?: Partial<ClassCounts>;
}

export interface DetectionBenchmarkResult extends DetectionEvaluation {
  samples: number;
  classMae: Partial<ClassCounts>;
}

/**
 * Evaluates count quality on a small, hand-labelled dealership set. The
 * benchmark is deliberately independent from ONNX so it can compare models,
 * thresholds, and imagery providers using the same samples.
 */
export function evaluateDetectionBenchmark(
  samples: DetectionBenchmarkSample[],
  dataset = "dealership-aerial-v1",
): DetectionBenchmarkResult {
  if (samples.length === 0) {
    return {
      dataset,
      evaluatedSamples: 0,
      countMae: 0,
      countBias: 0,
      within10PctRate: 0,
      evaluatedAt: new Date().toISOString(),
      samples: 0,
      classMae: {},
    };
  }

  const absoluteErrors = samples.map((s) =>
    Math.abs(s.predictedCount - s.expectedCount),
  );
  const relativeMatches = samples.filter((s) => {
    if (s.expectedCount === 0) return s.predictedCount === 0;
    return (
      Math.abs(s.predictedCount - s.expectedCount) / s.expectedCount <= 0.1
    );
  });
  // The product counts all supported detector classes as cars. Keep the
  // legacy shape readable, but benchmark only the user-facing category.
  const classes = ["car"] as const;
  const classMae = Object.fromEntries(
    classes.flatMap((vehicleClass) => {
      const values = samples
        .filter((s) => s.expectedClassCounts && s.predictedClassCounts)
        .map((s) =>
          Math.abs(
            (s.predictedClassCounts?.[vehicleClass] ?? 0) -
              (s.expectedClassCounts?.[vehicleClass] ?? 0),
          ),
        );
      return values.length > 0 ? [[vehicleClass, round(mean(values))]] : [];
    }),
  ) as Partial<ClassCounts>;

  return {
    dataset,
    evaluatedSamples: samples.length,
    countMae: round(mean(absoluteErrors)),
    countBias: round(
      mean(samples.map((s) => s.predictedCount - s.expectedCount)),
    ),
    within10PctRate: round(relativeMatches.length / samples.length),
    evaluatedAt: new Date().toISOString(),
    samples: samples.length,
    classMae,
  };
}

/** Adds a benchmark result to a detection without changing its count output. */
export function withDetectionEvaluation(
  detection: DetectionResult,
  evaluation: DetectionEvaluation,
): DetectionResult {
  return { ...detection, evaluation };
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

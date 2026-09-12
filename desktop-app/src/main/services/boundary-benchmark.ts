import type { BoundaryResult, Polygon } from "@shared/types";
import {
  approximatePolygonIoU,
  distanceToRingM,
  type LonLat,
} from "./boundary-geometry";
import { polygonAreaSqm } from "./geo-math";

export interface BoundaryBenchmarkSample {
  id: string;
  reference: Polygon;
  predicted: Polygon;
  predictedSource?: BoundaryResult["source"];
  predictedConfidence?: number;
}

export interface BoundaryBenchmarkResult {
  dataset: string;
  evaluatedSamples: number;
  meanIoU: number;
  meanBoundaryF1: number;
  meanCoverage: number;
  coverage90Rate: number;
  within2mBoundaryRate: number;
  meanAreaBias: number;
  calibration: BoundaryCalibration;
  evaluatedAt: string;
}

export interface BoundaryCalibration {
  bins: Array<{
    lower: number;
    upper: number;
    samples: number;
    meanConfidence: number;
    meanIoU: number;
  }>;
  meanAbsoluteError: number;
}

/**
 * Evaluates the geometry itself, not just the provider label. IoU follows
 * the object-matching convention used by footprint benchmarks; Boundary-F1
 * reports whether the outline is within a metric tolerance.
 */
export function evaluateBoundaryBenchmark(
  samples: BoundaryBenchmarkSample[],
  dataset = "dealership-boundary-v1",
): BoundaryBenchmarkResult {
  if (samples.length === 0) {
    return {
      dataset,
      evaluatedSamples: 0,
      meanIoU: 0,
      meanBoundaryF1: 0,
      meanCoverage: 0,
      coverage90Rate: 0,
      within2mBoundaryRate: 0,
      meanAreaBias: 0,
      calibration: emptyCalibration(),
      evaluatedAt: new Date().toISOString(),
    };
  }

  const evaluations = samples.map((sample) => evaluateSample(sample));
  const confidencePairs = evaluations.filter(
    (evaluation) => evaluation.confidence != null,
  );
  return {
    dataset,
    evaluatedSamples: samples.length,
    meanIoU: round(mean(evaluations.map((evaluation) => evaluation.iou))),
    meanBoundaryF1: round(
      mean(evaluations.map((evaluation) => evaluation.boundaryF1)),
    ),
    meanCoverage: round(
      mean(evaluations.map((evaluation) => evaluation.coverage)),
    ),
    coverage90Rate: round(
      evaluations.filter((evaluation) => evaluation.coverage >= 0.9).length /
        evaluations.length,
    ),
    within2mBoundaryRate: round(
      evaluations.filter((evaluation) => evaluation.boundaryF1 >= 0.8).length /
        evaluations.length,
    ),
    meanAreaBias: round(
      mean(evaluations.map((evaluation) => evaluation.areaBias)),
    ),
    calibration: buildCalibration(confidencePairs),
    evaluatedAt: new Date().toISOString(),
  };
}

function evaluateSample(sample: BoundaryBenchmarkSample): {
  iou: number;
  boundaryF1: number;
  coverage: number;
  areaBias: number;
  confidence?: number;
} {
  const iou = approximatePolygonIoU(sample.reference, sample.predicted);
  const referenceArea = polygonAreaSqm(
    sample.reference.coordinates[0] as LonLat[],
  );
  const predictedArea = polygonAreaSqm(
    sample.predicted.coordinates[0] as LonLat[],
  );
  const intersectionArea =
    iou === 0 ? 0 : (iou * (referenceArea + predictedArea)) / (1 + iou);
  const coverage = referenceArea === 0 ? 0 : intersectionArea / referenceArea;
  return {
    iou,
    boundaryF1: boundaryF1AtTolerance(sample.reference, sample.predicted, 2),
    coverage: Math.min(1, Math.max(0, coverage)),
    areaBias: referenceArea === 0 ? 0 : predictedArea / referenceArea - 1,
    confidence: sample.predictedConfidence,
  };
}

function boundaryF1AtTolerance(
  reference: Polygon,
  predicted: Polygon,
  toleranceM: number,
): number {
  const refRing = reference.coordinates[0] as LonLat[];
  const predRing = predicted.coordinates[0] as LonLat[];
  const precision =
    predRing.length < 2
      ? 0
      : predRing.filter(
          (point) => distanceToRingM(point, refRing) <= toleranceM,
        ).length / predRing.length;
  const recall =
    refRing.length < 2
      ? 0
      : refRing.filter(
          (point) => distanceToRingM(point, predRing) <= toleranceM,
        ).length / refRing.length;
  return precision + recall === 0
    ? 0
    : (2 * precision * recall) / (precision + recall);
}

function buildCalibration(
  evaluations: Array<{ confidence?: number; iou: number }>,
): BoundaryCalibration {
  const bins = Array.from({ length: 10 }, (_, index) => {
    const lower = index / 10;
    const upper = index === 9 ? 1.01 : (index + 1) / 10;
    const values = evaluations.filter(
      (evaluation) =>
        evaluation.confidence != null &&
        evaluation.confidence >= lower &&
        evaluation.confidence < upper,
    );
    return {
      lower,
      upper: Math.min(1, upper),
      samples: values.length,
      meanConfidence: round(
        values.length > 0 ? mean(values.map((value) => value.confidence!)) : 0,
      ),
      meanIoU: round(
        values.length > 0 ? mean(values.map((value) => value.iou)) : 0,
      ),
    };
  });
  return {
    bins,
    meanAbsoluteError:
      evaluations.length === 0
        ? 0
        : round(
            mean(
              evaluations.map((evaluation) =>
                Math.abs((evaluation.confidence ?? 0) - evaluation.iou),
              ),
            ),
          ),
  };
}

function emptyCalibration(): BoundaryCalibration {
  return buildCalibration([]);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

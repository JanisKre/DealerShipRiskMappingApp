import type { BoundaryResult, Polygon } from "@shared/types";
import { distanceToRingM, type LonLat } from "./boundary-geometry";
import { polygonAreaSqm } from "./geo-math";
import { coveringGrid, rasterizeMaskPolygon } from "./boundary/rasterize";

/**
 * Benchmark grid resolution. Deliberately finer than the 2 m Boundary-F1
 * tolerance this evaluator also reports, so the overlap metric can actually
 * resolve the errors the tolerance metric is measuring.
 */
export const BENCHMARK_RESOLUTION_M = 0.5;

export interface BoundaryBenchmarkSample {
  id: string;
  reference: Polygon;
  predicted: Polygon;
  predictedSource?: BoundaryResult["source"];
  predictedConfidence?: number;
}

export interface BoundaryBenchmarkOptions {
  dataset?: string;
  /** Grid cell size for the overlap metrics. */
  resolutionM?: number;
}

export interface BoundaryBenchmarkResult {
  dataset: string;
  resolutionM: number;
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
  options: BoundaryBenchmarkOptions = {},
): BoundaryBenchmarkResult {
  const dataset = options.dataset ?? "dealership-boundary-v1";
  const resolutionM = options.resolutionM ?? BENCHMARK_RESOLUTION_M;
  if (samples.length === 0) {
    return {
      dataset,
      resolutionM,
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

  const evaluations = samples.map((sample) =>
    evaluateSample(sample, resolutionM),
  );
  const confidencePairs = evaluations.filter(
    (evaluation) => evaluation.confidence != null,
  );
  return {
    dataset,
    resolutionM,
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

function evaluateSample(
  sample: BoundaryBenchmarkSample,
  resolutionM: number,
): {
  iou: number;
  boundaryF1: number;
  coverage: number;
  areaBias: number;
  confidence?: number;
} {
  const referenceRing = sample.reference.coordinates[0] as LonLat[];
  const predictedRing = sample.predicted.coordinates[0] as LonLat[];
  const referenceArea = polygonAreaSqm(referenceRing);
  const predictedArea = polygonAreaSqm(predictedRing);

  // IoU and coverage are measured on one shared raster rather than derived
  // algebraically from IoU. The old derivation assumed a relationship between
  // intersection and union that only holds exactly, which made coverage a
  // restatement of IoU instead of an independent signal.
  const { iou, coverage } = overlapMetrics(
    referenceRing,
    predictedRing,
    resolutionM,
  );

  return {
    iou,
    boundaryF1: boundaryF1AtTolerance(sample.reference, sample.predicted, 2),
    coverage,
    areaBias: referenceArea === 0 ? 0 : predictedArea / referenceArea - 1,
    confidence: sample.predictedConfidence,
  };
}

function overlapMetrics(
  referenceRing: LonLat[],
  predictedRing: LonLat[],
  resolutionM: number,
): { iou: number; coverage: number } {
  if (referenceRing.length < 4 || predictedRing.length < 4) {
    return { iou: 0, coverage: 0 };
  }
  const { spec } = coveringGrid([referenceRing, predictedRing], resolutionM);
  const cells = spec.cols * spec.rows;
  const referenceMask = new Uint8Array(cells);
  const predictedMask = new Uint8Array(cells);
  rasterizeMaskPolygon(spec, referenceRing, referenceMask);
  rasterizeMaskPolygon(spec, predictedRing, predictedMask);

  let intersection = 0;
  let union = 0;
  let referenceCells = 0;
  for (let i = 0; i < cells; i += 1) {
    const inReference = referenceMask[i] !== 0;
    const inPredicted = predictedMask[i] !== 0;
    if (inReference) referenceCells += 1;
    if (inReference && inPredicted) intersection += 1;
    if (inReference || inPredicted) union += 1;
  }
  return {
    iou: union === 0 ? 0 : intersection / union,
    coverage: referenceCells === 0 ? 0 : intersection / referenceCells,
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

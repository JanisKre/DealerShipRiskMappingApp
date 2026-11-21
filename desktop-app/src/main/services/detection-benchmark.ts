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

/** One ground-truth box of a tile in an n×n grid of abutting tiles. */
export interface TileLabel {
  row: number;
  col: number;
  /** Corner points normalised to the tile: x1 y1 x2 y2 … (YOLO OBB order). */
  corners: number[];
}

/**
 * Vehicles in a grid of abutting tiles, counting a vehicle that a tile seam
 * cuts in two only once. Training labels are clipped to their tile, so such
 * a vehicle is two boxes, each touching the shared edge; the app's mosaic
 * sees it whole. Two boxes in neighbouring tiles are one vehicle when both
 * reach the seam (within `tolerance` of a tile edge) and overlap along it by
 * at least half of the shorter one.
 */
export function countMosaicLabels(
  labels: readonly TileLabel[],
  tolerance = 0.01,
): number {
  const boxes = labels.map((label) => {
    const xs = label.corners.filter((_, i) => i % 2 === 0);
    const ys = label.corners.filter((_, i) => i % 2 === 1);
    return {
      row: label.row,
      col: label.col,
      x0: label.col + Math.min(...xs),
      x1: label.col + Math.max(...xs),
      y0: label.row + Math.min(...ys),
      y1: label.row + Math.max(...ys),
    };
  });
  const parent = boxes.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const overlap = (a0: number, a1: number, b0: number, b1: number): boolean =>
    Math.min(a1, b1) - Math.max(a0, b0) >= 0.5 * Math.min(a1 - a0, b1 - b0);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = 0; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];
      const right = a.row === b.row && b.col === a.col + 1;
      const below = a.col === b.col && b.row === a.row + 1;
      const cut = right
        ? a.x1 >= b.col - tolerance &&
          b.x0 <= b.col + tolerance &&
          overlap(a.y0, a.y1, b.y0, b.y1)
        : below
          ? a.y1 >= b.row - tolerance &&
            b.y0 <= b.row + tolerance &&
            overlap(a.x0, a.x1, b.x0, b.x1)
          : false;
      if (cut) parent[find(i)] = find(j);
    }
  }
  return new Set(boxes.map((_, i) => find(i))).size;
}

/**
 * Percentile bootstrap interval of the count MAE over sites, with a fixed
 * seed so a benchmark run is reproducible. With a few dozen sites the
 * interval is wide, and two models whose intervals overlap are not shown to
 * differ.
 */
export function bootstrapMaeInterval(
  samples: readonly DetectionBenchmarkSample[],
  options: { iterations?: number; seed?: number; level?: number } = {},
): { low: number; high: number } {
  const { iterations = 2000, seed = 20261121, level = 0.9 } = options;
  if (samples.length === 0) return { low: 0, high: 0 };
  const random = mulberry32(seed);
  const errors = samples.map((s) =>
    Math.abs(s.predictedCount - s.expectedCount),
  );
  const maes: number[] = [];
  for (let k = 0; k < iterations; k++) {
    let sum = 0;
    for (let i = 0; i < errors.length; i++) {
      sum += errors[Math.floor(random() * errors.length)];
    }
    maes.push(sum / errors.length);
  }
  maes.sort((a, b) => a - b);
  const at = (q: number): number =>
    maes[Math.min(maes.length - 1, Math.max(0, Math.floor(q * maes.length)))];
  return {
    low: round(at((1 - level) / 2)),
    high: round(at(1 - (1 - level) / 2)),
  };
}

/** Small deterministic PRNG (Mulberry32) for the bootstrap. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

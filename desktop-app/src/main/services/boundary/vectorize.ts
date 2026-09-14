import {
  isSimpleRing,
  unprojectPoint,
  type LonLat,
  type Point2D,
} from "../boundary-geometry";
import { cellIndex, cornerToOffset, isInside, type GridSpec } from "./grid";

/**
 * Raster mask to polygon.
 *
 * The contour is traced along cell edges, simplified, and then — because
 * dealership lots are overwhelmingly rectilinear — squared up against their own
 * dominant axis. Without that last step the output is a 0.5 m staircase, which
 * reads as noise on a map and makes the outline metric meaningless.
 *
 * Every step has a fallback to the previous one. A regularization that would
 * self-intersect or materially change the area is discarded rather than
 * shipped: a plausible-looking wrong shape is worse than an honest jagged one.
 */

/** Ring orientation is irrelevant downstream; area and checks use absolutes. */
const CORNER_OFFSETS: ReadonlyArray<readonly [number, number, number, number]> =
  [
    // [dCol, dRow, edge start corner index, edge end corner index]
    [0, -1, 0, 1], // north side: (col,row) -> (col+1,row)
    [1, 0, 1, 2], // east side:  (col+1,row) -> (col+1,row+1)
    [0, 1, 2, 3], // south side: (col+1,row+1) -> (col,row+1)
    [-1, 0, 3, 0], // west side:  (col,row+1) -> (col,row)
  ];

function cornerOf(col: number, row: number, index: number): [number, number] {
  switch (index) {
    case 0:
      return [col, row];
    case 1:
      return [col + 1, row];
    case 2:
      return [col + 1, row + 1];
    default:
      return [col, row + 1];
  }
}

/**
 * Traces closed contours along the mask's cell edges.
 *
 * Each set cell contributes a directed edge for every side facing outside,
 * wound consistently so the chains join head-to-tail without ambiguity. This
 * relies on the mask being 4-connected (which region growing guarantees): with
 * 8-connectivity two cells could meet only at a corner, and the trace there
 * would have two equally valid continuations.
 *
 * Returns rings in corner coordinates, largest first.
 */
export function maskToRings(spec: GridSpec, mask: Uint8Array): Point2D[][] {
  const cornerCols = spec.cols + 1;
  const keyOf = (x: number, y: number): number => y * cornerCols + x;
  const outgoing = new Map<number, number[]>();
  const points = new Map<number, Point2D>();

  for (let row = 0; row < spec.rows; row += 1) {
    for (let col = 0; col < spec.cols; col += 1) {
      if (!mask[cellIndex(spec, col, row)]) continue;
      for (const [dCol, dRow, from, to] of CORNER_OFFSETS) {
        const nCol = col + dCol;
        const nRow = row + dRow;
        const neighbourSet =
          isInside(spec, nCol, nRow) && mask[cellIndex(spec, nCol, nRow)];
        if (neighbourSet) continue;
        const a = cornerOf(col, row, from);
        const b = cornerOf(col, row, to);
        const aKey = keyOf(a[0], a[1]);
        const bKey = keyOf(b[0], b[1]);
        points.set(aKey, a);
        points.set(bKey, b);
        const list = outgoing.get(aKey);
        if (list) list.push(bKey);
        else outgoing.set(aKey, [bKey]);
      }
    }
  }

  const rings: Point2D[][] = [];
  for (const [startKey, targets] of outgoing) {
    while (targets.length > 0) {
      const ring: Point2D[] = [];
      let currentKey = startKey;
      let nextKey: number | undefined = targets.pop();
      ring.push(points.get(currentKey)!);
      // Bounded by the total number of edges; a malformed graph cannot spin.
      let guard = spec.cols * spec.rows * 4 + 8;
      while (nextKey != null && guard-- > 0) {
        ring.push(points.get(nextKey)!);
        if (nextKey === startKey) break;
        currentKey = nextKey;
        const options = outgoing.get(currentKey);
        nextKey = options && options.length > 0 ? options.pop() : undefined;
      }
      if (ring.length >= 4) rings.push(closeRing(ring));
    }
  }

  return rings.sort((a, b) => Math.abs(area2D(b)) - Math.abs(area2D(a)));
}

function closeRing(ring: Point2D[]): Point2D[] {
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) return [...ring, [...first]];
  return ring;
}

/** Shoelace area in the ring's own units. Signed. */
export function area2D(ring: Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    sum += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
  }
  return sum / 2;
}

/** Douglas-Peucker, applied to a closed ring. */
export function simplifyRing(ring: Point2D[], epsilon: number): Point2D[] {
  if (ring.length <= 4 || epsilon <= 0) return ring;
  const open = ring.slice(0, -1);
  // Anchor on the two most distant points so the split is stable regardless of
  // where the trace happened to start.
  const anchorA = 0;
  let anchorB = 0;
  let best = -1;
  for (let i = 1; i < open.length; i += 1) {
    const d = distanceSq(open[0], open[i]);
    if (d > best) {
      best = d;
      anchorB = i;
    }
  }
  const first = [...open.slice(anchorA, anchorB + 1)];
  const second = [...open.slice(anchorB), open[anchorA]];
  const simplified = [
    ...douglasPeucker(first, epsilon).slice(0, -1),
    ...douglasPeucker(second, epsilon).slice(0, -1),
  ];
  return simplified.length >= 3 ? closeRing(simplified) : ring;
}

function douglasPeucker(points: Point2D[], epsilon: number): Point2D[] {
  if (points.length < 3) return points;
  let index = 0;
  let maxDistance = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = perpendicularDistance(
      points[i],
      points[0],
      points[points.length - 1],
    );
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= epsilon) return [points[0], points[points.length - 1]];
  return [
    ...douglasPeucker(points.slice(0, index + 1), epsilon).slice(0, -1),
    ...douglasPeucker(points.slice(index), epsilon),
  ];
}

function perpendicularDistance(p: Point2D, a: Point2D, b: Point2D): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
  const clamped = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + clamped * dx), p[1] - (a[1] + clamped * dy));
}

function distanceSq(a: Point2D, b: Point2D): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/**
 * The ring's dominant orientation, in [0, PI/2).
 *
 * Segment directions are folded into a quarter turn (a lot's long and short
 * sides describe the same grid) and weighted by length, so a handful of short
 * jagged segments cannot outvote the two long street-facing edges.
 */
export function dominantAngleRad(ring: Point2D[]): number {
  const BINS = 90;
  const histogram = new Float64Array(BINS);
  for (let i = 0; i < ring.length - 1; i += 1) {
    const dx = ring[i + 1][0] - ring[i][0];
    const dy = ring[i + 1][1] - ring[i][1];
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    let angle = Math.atan2(dy, dx);
    // Fold into [0, PI/2).
    angle = ((angle % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    const bin = Math.min(BINS - 1, Math.floor((angle / (Math.PI / 2)) * BINS));
    histogram[bin] += length;
  }

  let peak = 0;
  for (let i = 1; i < BINS; i += 1) {
    if (histogram[i] > histogram[peak]) peak = i;
  }
  // Parabolic refinement against the neighbouring bins, so the answer is not
  // quantised to whole degrees.
  const left = histogram[(peak - 1 + BINS) % BINS];
  const centre = histogram[peak];
  const right = histogram[(peak + 1) % BINS];
  const denominator = left - 2 * centre + right;
  const shift = denominator === 0 ? 0 : (0.5 * (left - right)) / denominator;
  const binWidth = Math.PI / 2 / BINS;
  return (peak + 0.5 + Math.max(-0.5, Math.min(0.5, shift))) * binWidth;
}

function rotate(ring: Point2D[], angle: number): Point2D[] {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return ring.map(([x, y]) => [x * cos - y * sin, x * sin + y * cos]);
}

/**
 * Squares the ring up against `angleRad`.
 *
 * Segments within `toleranceDeg` of an axis are snapped to their own
 * length-weighted mean, which removes the raster staircase while leaving a
 * genuinely diagonal edge — a lot cut by a railway, say — alone.
 *
 * Returns the input unchanged if the result would self-intersect or change the
 * area by more than `maxAreaChange`.
 */
export function regularizeRectilinear(
  ring: Point2D[],
  angleRad: number,
  toleranceDeg: number,
  maxAreaChange = 0.15,
): Point2D[] {
  if (ring.length < 5 || toleranceDeg <= 0) return ring;
  const tolerance = (toleranceDeg * Math.PI) / 180;
  const rotated = rotate(ring.slice(0, -1), -angleRad);
  const count = rotated.length;

  const xSum = new Float64Array(count);
  const xWeight = new Float64Array(count);
  const ySum = new Float64Array(count);
  const yWeight = new Float64Array(count);

  for (let i = 0; i < count; i += 1) {
    const a = rotated[i];
    const b = rotated[(i + 1) % count];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length === 0) continue;
    const angle = Math.atan2(Math.abs(dy), Math.abs(dx));
    const next = (i + 1) % count;
    if (angle <= tolerance) {
      // Horizontal: both endpoints share one y.
      const meanY = (a[1] + b[1]) / 2;
      ySum[i] += meanY * length;
      yWeight[i] += length;
      ySum[next] += meanY * length;
      yWeight[next] += length;
    } else if (Math.PI / 2 - angle <= tolerance) {
      const meanX = (a[0] + b[0]) / 2;
      xSum[i] += meanX * length;
      xWeight[i] += length;
      xSum[next] += meanX * length;
      xWeight[next] += length;
    }
  }

  const snapped: Point2D[] = rotated.map(([x, y], i) => [
    xWeight[i] > 0 ? xSum[i] / xWeight[i] : x,
    yWeight[i] > 0 ? ySum[i] / yWeight[i] : y,
  ]);

  const deduped = dedupeConsecutive(snapped, 1e-9);
  if (deduped.length < 3) return ring;
  const result = closeRing(rotate(deduped, angleRad));

  if (!isSimpleRing(result)) return ring;
  const before = Math.abs(area2D(ring));
  const after = Math.abs(area2D(result));
  if (before === 0) return ring;
  if (Math.abs(after - before) / before > maxAreaChange) return ring;
  return result;
}

function dedupeConsecutive(ring: Point2D[], tolerance: number): Point2D[] {
  const out: Point2D[] = [];
  for (const point of ring) {
    const last = out[out.length - 1];
    if (
      last &&
      Math.abs(last[0] - point[0]) <= tolerance &&
      Math.abs(last[1] - point[1]) <= tolerance
    ) {
      continue;
    }
    out.push(point);
  }
  while (
    out.length > 1 &&
    Math.abs(out[0][0] - out[out.length - 1][0]) <= tolerance &&
    Math.abs(out[0][1] - out[out.length - 1][1]) <= tolerance
  ) {
    out.pop();
  }
  return out;
}

/** Corner-space ring to geographic ring. */
export function ringToLonLat(spec: GridSpec, ring: Point2D[]): LonLat[] {
  return ring.map(([x, y]) =>
    unprojectPoint(cornerToOffset(spec, x, y), spec.origin),
  );
}

export interface VectorizeOptions {
  /** Douglas-Peucker tolerance, in metres. */
  simplifyToleranceM?: number;
  /** Segments within this angle of the dominant axis are squared up. */
  regularizeAngleToleranceDeg?: number;
}

export interface VectorizeResult {
  ring: LonLat[];
  /** Dominant orientation, for reporting. */
  angleRad: number;
  /** False when regularization was rejected by its own safety checks. */
  regularized: boolean;
}

/** Mask to geographic ring: trace, simplify, square up. */
export function maskToPolygon(
  spec: GridSpec,
  mask: Uint8Array,
  options: VectorizeOptions = {},
): VectorizeResult | null {
  const rings = maskToRings(spec, mask);
  if (rings.length === 0) return null;
  const outer = rings[0];
  if (outer.length < 4) return null;

  const epsilonCells = (options.simplifyToleranceM ?? 1) / spec.resolutionM;
  const simplified = simplifyRing(outer, epsilonCells);
  const angleRad = dominantAngleRad(simplified);

  const toleranceDeg = options.regularizeAngleToleranceDeg ?? 12;
  const squared = regularizeRectilinear(simplified, angleRad, toleranceDeg);
  const regularized = squared !== simplified;

  const ring = ringToLonLat(spec, squared);
  return ring.length >= 4 ? { ring, angleRad, regularized } : null;
}

import type { Polygon } from "@shared/types";

export type LonLat = [number, number];

export interface GeometryCheck {
  valid: boolean;
  areaSqm: number;
  reason?: string;
}

const METERS_PER_DEGREE = 111_320;

export function projectPoint(point: LonLat, origin: LonLat): [number, number] {
  const cosLat = Math.cos((origin[1] * Math.PI) / 180);
  return [
    (point[0] - origin[0]) * METERS_PER_DEGREE * cosLat,
    (point[1] - origin[1]) * METERS_PER_DEGREE,
  ];
}

export function ringAreaSqm(ring: LonLat[]): number {
  if (ring.length < 4) return 0;
  const origin = ring[0];
  const projected = ring.map((point) => projectPoint(point, origin));
  let area = 0;
  for (let i = 0; i < projected.length - 1; i += 1) {
    area +=
      projected[i][0] * projected[i + 1][1] -
      projected[i + 1][0] * projected[i][1];
  }
  return Math.abs(area / 2);
}

export function checkRing(
  ring: LonLat[],
  options: { minAreaSqm?: number; maxAreaSqm?: number } = {},
): GeometryCheck {
  if (ring.length < 4) {
    return { valid: false, areaSqm: 0, reason: "ring has fewer than 4 points" };
  }
  if (
    !ring.every(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
  ) {
    return {
      valid: false,
      areaSqm: 0,
      reason: "ring contains non-finite coordinates",
    };
  }
  if (
    ring.some(([lon, lat]) => lon < -180 || lon > 180 || lat < -90 || lat > 90)
  ) {
    return {
      valid: false,
      areaSqm: 0,
      reason: "coordinates are outside lon/lat bounds",
    };
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    return { valid: false, areaSqm: 0, reason: "ring is not closed" };
  }
  const areaSqm = ringAreaSqm(ring);
  const minAreaSqm = options.minAreaSqm ?? 1;
  const maxAreaSqm = options.maxAreaSqm ?? 2_000_000;
  if (areaSqm < minAreaSqm) {
    return { valid: false, areaSqm, reason: "ring area is too small" };
  }
  if (areaSqm > maxAreaSqm) {
    return { valid: false, areaSqm, reason: "ring area is implausibly large" };
  }
  for (let i = 0; i < ring.length - 1; i += 1) {
    for (let j = i + 1; j < ring.length - 1; j += 1) {
      if (j === i + 1 || (i === 0 && j === ring.length - 2)) continue;
      if (
        segmentsIntersect(
          projectPoint(ring[i], first),
          projectPoint(ring[i + 1], first),
          projectPoint(ring[j], first),
          projectPoint(ring[j + 1], first),
        )
      ) {
        return { valid: false, areaSqm, reason: "ring self-intersects" };
      }
    }
  }
  return { valid: true, areaSqm };
}

export function distanceToRingM(point: LonLat, ring: LonLat[]): number {
  if (ring.length < 2) return Infinity;
  const origin = point;
  const p = projectPoint(point, origin);
  let best = Infinity;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = projectPoint(ring[i], origin);
    const b = projectPoint(ring[i + 1], origin);
    best = Math.min(best, pointToSegmentDistance(p, a, b));
  }
  return best;
}

/** Approximate polygon IoU in a local metric grid; deterministic and dependency-free. */
export function approximatePolygonIoU(
  a: Polygon,
  b: Polygon,
  cellSizeM = 5,
): number {
  const ringA = a.coordinates[0] as LonLat[];
  const ringB = b.coordinates[0] as LonLat[];
  if (ringA.length < 4 || ringB.length < 4) return 0;
  const origin = ringA[0];
  const points = [...ringA, ...ringB].map((point) =>
    projectPoint(point, origin),
  );
  const minX = Math.min(...points.map(([x]) => x));
  const maxX = Math.max(...points.map(([x]) => x));
  const minY = Math.min(...points.map(([, y]) => y));
  const maxY = Math.max(...points.map(([, y]) => y));
  const cols = Math.min(200, Math.max(1, Math.ceil((maxX - minX) / cellSizeM)));
  const rows = Math.min(200, Math.max(1, Math.ceil((maxY - minY) / cellSizeM)));
  let intersection = 0;
  let union = 0;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const projected: [number, number] = [
        minX + ((col + 0.5) / cols) * (maxX - minX),
        minY + ((row + 0.5) / rows) * (maxY - minY),
      ];
      const sample: LonLat = [
        origin[0] +
          projected[0] /
            (METERS_PER_DEGREE * Math.cos((origin[1] * Math.PI) / 180)),
        origin[1] + projected[1] / METERS_PER_DEGREE,
      ];
      const inA = pointInRing(sample, ringA);
      const inB = pointInRing(sample, ringB);
      if (inA || inB) union += 1;
      if (inA && inB) intersection += 1;
    }
  }
  return union === 0 ? 0 : intersection / union;
}

function pointInRing(point: LonLat, ring: LonLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > point[1] !== yj > point[1];
    if (crosses && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

function pointToSegmentDistance(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy),
    ),
  );
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function orientation(
  a: [number, number],
  b: [number, number],
  c: [number, number],
): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

// --- Convex / concave hull (generic 2D points, e.g. pixel or lon/lat) ------

export type Point2D = [number, number];

function keyOf(p: Point2D): string {
  return `${p[0]}:${p[1]}`;
}

function dedupePoints(points: Point2D[]): Point2D[] {
  return Array.from(new Map(points.map((p) => [keyOf(p), p])).values());
}

function closeRing2D(ring: Point2D[]): Point2D[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

/** Standard Andrew's monotone chain convex hull. Returns a closed ring. */
export function convexHull(points: Point2D[]): Point2D[] {
  const unique = dedupePoints(points).sort(
    (a, b) => a[0] - b[0] || a[1] - b[1],
  );
  if (unique.length < 3) return closeRing2D(unique);
  const lower: Point2D[] = [];
  for (const point of unique) {
    while (
      lower.length >= 2 &&
      orientation(lower.at(-2)!, lower.at(-1)!, point) <= 0
    )
      lower.pop();
    lower.push(point);
  }
  const upper: Point2D[] = [];
  for (const point of [...unique].reverse()) {
    while (
      upper.length >= 2 &&
      orientation(upper.at(-2)!, upper.at(-1)!, point) <= 0
    )
      upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return closeRing2D([...lower, ...upper]);
}

function samePoint(a: Point2D, b: Point2D): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function segmentsIntersectAny(
  p: Point2D,
  q: Point2D,
  path: Point2D[],
): boolean {
  for (let i = 0; i < path.length - 1; i += 1) {
    const c = path[i];
    const d = path[i + 1];
    // Segments that share an endpoint with (p,q) touch by construction —
    // that's adjacency, not a crossing.
    if (
      samePoint(c, p) ||
      samePoint(c, q) ||
      samePoint(d, p) ||
      samePoint(d, q)
    )
      continue;
    if (segmentsIntersect(p, q, c, d)) return true;
  }
  return false;
}

/**
 * Filters a raster-aligned point set (grid spacing `step`) down to cells
 * that touch at least one empty 8-neighbor — i.e. the region's outline.
 * Use this before `nonConvexHull` when the source is a dense area fill
 * (e.g. every paved pixel of a lot) rather than an already-sparse outline.
 */
export function outlinePoints(points: Point2D[], step: number): Point2D[] {
  const set = new Set(points.map(keyOf));
  const offsets: Point2D[] = [
    [-step, -step],
    [0, -step],
    [step, -step],
    [-step, 0],
    [step, 0],
    [-step, step],
    [0, step],
    [step, step],
  ];
  return points.filter(([x, y]) =>
    offsets.some(([dx, dy]) => !set.has(keyOf([x + dx, y + dy]))),
  );
}

export interface NonConvexHullOptions {
  /** Max recursive subdivisions per original hull edge. */
  maxDepth?: number;
  /** A dig only fires when perpendicular offset exceeds this share of the edge length. */
  concavityRatio?: number;
  /** Minimum perpendicular offset (same unit as the input points) worth digging into. */
  minDigDistance?: number;
}

/**
 * Concave ("digging") hull: starts from the convex hull and, for every edge,
 * pulls in the interior point that best explains a concavity along that
 * edge — but only when the indentation is geometrically significant and
 * doesn't self-intersect.
 *
 * This replaces a plain convex hull for paved-surface footprints: a convex
 * hull bridges concave notches (e.g. an L-shaped site, or two separated
 * parking islands) with a straight edge that silently swallows whatever
 * lies in the notch — trees, roads, neighbouring lots. Industrial sites are
 * disproportionately non-convex, which is exactly where that bias showed up.
 *
 * `points` should approximate the shape's *outline* (e.g. only the
 * perimeter cells of a filled raster mask), not a dense interior fill —
 * candidates are picked by perpendicular distance from each hull edge, and a
 * deep-interior point of a solid fill is trivially "far" from some edge
 * without indicating any real concavity there. Callers with a raster mask
 * should pre-filter to boundary cells first.
 *
 * As a safety net, the result is rejected in favor of the plain convex hull
 * if it would end up self-intersecting — this can never enclose *less* area
 * than the true point-cloud shape, and never more than the convex hull.
 */
export function nonConvexHull(
  points: Point2D[],
  options: NonConvexHullOptions = {},
): Point2D[] {
  const maxDepth = options.maxDepth ?? 6;
  const concavityRatio = options.concavityRatio ?? 0.12;
  const minDigDistance = options.minDigDistance ?? 3;

  const unique = dedupePoints(points);
  if (unique.length < 4) return closeRing2D(unique);

  const hull = convexHull(unique);
  const openHull = hull.slice(0, -1);
  if (openHull.length < 3) return hull;
  const hullKeys = new Set(openHull.map(keyOf));
  const interior = unique.filter((p) => !hullKeys.has(keyOf(p)));
  const center: Point2D = [
    openHull.reduce((sum, p) => sum + p[0], 0) / openHull.length,
    openHull.reduce((sum, p) => sum + p[1], 0) / openHull.length,
  ];

  // Assign every interior point to its single nearest hull edge before
  // digging. Without this, a point that genuinely belongs to a distant,
  // unrelated part of the outline can still pass the local side/ratio
  // checks for some other short edge (its perpendicular offset from that
  // edge's line is large simply because it's far away, not because it
  // reveals a concavity there) — producing a nonsensical, self-intersecting
  // "dig" clear across the shape.
  const buckets: Point2D[][] = openHull.map(() => []);
  for (const p of interior) {
    let bestEdge = 0;
    let bestDist = Infinity;
    for (let i = 0; i < openHull.length; i += 1) {
      const d = pointToSegmentDistance(
        p,
        openHull[i],
        openHull[(i + 1) % openHull.length],
      );
      if (d < bestDist) {
        bestDist = d;
        bestEdge = i;
      }
    }
    buckets[bestEdge].push(p);
  }

  const used = new Set<string>();
  const result: Point2D[] = [];
  for (let i = 0; i < openHull.length; i += 1) {
    const a = openHull[i];
    const b = openHull[(i + 1) % openHull.length];
    result.push(a);
    digEdge(
      a,
      b,
      buckets[i],
      used,
      center,
      result,
      maxDepth,
      concavityRatio,
      minDigDistance,
    );
  }
  const dug = closeRing2D(result);
  return isSimpleRing(dug) ? dug : hull;
}

function isSimpleRing(ring: Point2D[]): boolean {
  const open = ring.slice(0, -1);
  for (let i = 0; i < open.length; i += 1) {
    for (let j = i + 1; j < open.length; j += 1) {
      if (j === i + 1 || (i === 0 && j === open.length - 1)) continue;
      if (
        segmentsIntersect(
          open[i],
          open[(i + 1) % open.length],
          open[j],
          open[(j + 1) % open.length],
        )
      )
        return false;
    }
  }
  return true;
}

function digEdge(
  a: Point2D,
  b: Point2D,
  interior: Point2D[],
  used: Set<string>,
  interiorRefPoint: Point2D,
  out: Point2D[],
  depth: number,
  concavityRatio: number,
  minDigDistance: number,
): void {
  if (depth <= 0) return;
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const edgeLen = Math.hypot(abx, aby);
  if (edgeLen < minDigDistance * 2) return;
  const interiorSign = Math.sign(orientation(a, b, interiorRefPoint)) || 1;

  let best: { point: Point2D; perp: number } | null = null;
  for (const p of interior) {
    const key = keyOf(p);
    if (used.has(key)) continue;
    const apx = p[0] - a[0];
    const apy = p[1] - a[1];
    const t = (apx * abx + apy * aby) / (edgeLen * edgeLen);
    if (t <= 0.08 || t >= 0.92) continue; // stay clear of the endpoints
    const cross = abx * apy - aby * apx;
    if (cross !== 0 && Math.sign(cross) !== interiorSign) continue;
    const perp = Math.abs(cross) / edgeLen;
    if (perp < minDigDistance || perp / edgeLen < concavityRatio) continue;
    if (!best || perp > best.perp) best = { point: p, perp };
  }
  if (!best) return;
  if (
    segmentsIntersectAny(a, best.point, out) ||
    segmentsIntersectAny(best.point, b, out)
  ) {
    return;
  }

  used.add(keyOf(best.point));
  digEdge(
    a,
    best.point,
    interior,
    used,
    interiorRefPoint,
    out,
    depth - 1,
    concavityRatio,
    minDigDistance,
  );
  out.push(best.point);
  digEdge(
    best.point,
    b,
    interior,
    used,
    interiorRefPoint,
    out,
    depth - 1,
    concavityRatio,
    minDigDistance,
  );
}

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

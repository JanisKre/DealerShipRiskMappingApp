import type { HailZone, HailZoneOverlayArea } from "@shared/types";

/**
 * Converts the postcode TopoJSON (one polygon per postcode, shared arcs) into
 * simplified overlay areas that carry the hail zone of each postcode.
 *
 * Simplification runs on the shared arcs, not on the rings, so two
 * neighbouring postcodes keep identical borders and no gaps open between them.
 */

type Position = [number, number];

export interface PostcodeTopology {
  arcs: Position[][];
  objects: Record<
    string,
    {
      geometries: Array<{
        type: string;
        arcs?: unknown;
        properties?: { postcode?: unknown };
      }>;
    }
  >;
}

/** ~130 m: finer than a postcode border matters at country scale. */
export const DEFAULT_EPSILON_DEG = 0.0012;
const COORDINATE_DECIMALS = 4;

/** Squared distance from `p` to the segment `a`–`b` (planar, in degrees). */
function segmentDistanceSq(p: Position, a: Position, b: Position): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  let t =
    lengthSq === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  const ex = p[0] - (a[0] + t * dx);
  const ey = p[1] - (a[1] + t * dy);
  return ex * ex + ey * ey;
}

/** Douglas–Peucker; keeps both end points. Iterative: arcs can be long. */
export function simplifyLine(points: Position[], epsilon: number): Position[] {
  if (points.length <= 2) return points;
  const epsilonSq = epsilon * epsilon;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let maxSq = 0;
    let index = -1;
    for (let i = first + 1; i < last; i++) {
      const d = segmentDistanceSq(points[i], points[first], points[last]);
      if (d > maxSq) {
        maxSq = d;
        index = i;
      }
    }
    if (index !== -1 && maxSq > epsilonSq) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

function round(value: number): number {
  const factor = 10 ** COORDINATE_DECIMALS;
  return Math.round(value * factor) / factor;
}

/** Closed ring from arc indices (a negative index `~i` runs arc `i` backwards). */
function buildRing(arcIndices: number[], arcs: Position[][]): Position[] {
  const ring: Position[] = [];
  for (const index of arcIndices) {
    const arc = index >= 0 ? arcs[index] : [...arcs[~index]].reverse();
    // The first point of a segment repeats the last point of the previous one.
    for (let i = ring.length === 0 ? 0 : 1; i < arc.length; i++)
      ring.push(arc[i]);
  }
  return ring;
}

function isArcIndexList(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.every((v) => Number.isInteger(v)) &&
    value.length > 0
  );
}

/** Polygon rings of a `Polygon` (`arcs`: rings) or `MultiPolygon` geometry. */
function polygonsOf(type: string, arcs: unknown): number[][][] | null {
  if (type === "Polygon" && Array.isArray(arcs) && arcs.every(isArcIndexList))
    return [arcs as number[][]];
  if (type === "MultiPolygon" && Array.isArray(arcs)) {
    const polygons: number[][][] = [];
    for (const polygon of arcs) {
      if (!Array.isArray(polygon) || !polygon.every(isArcIndexList))
        return null;
      polygons.push(polygon as number[][]);
    }
    return polygons;
  }
  return null;
}

export function topologyToOverlayAreas(
  topology: PostcodeTopology,
  zoneOf: (postcode: string) => HailZone | null,
  epsilon = DEFAULT_EPSILON_DEG,
): HailZoneOverlayArea[] {
  const arcCount = topology.arcs.length;
  const simplified = topology.arcs.map((arc) => simplifyLine(arc, epsilon));
  const inRange = (indices: number[]): boolean =>
    indices.every((i) => (i >= 0 ? i : ~i) < arcCount);

  const geometries = Object.values(topology.objects).flatMap(
    (object) => object.geometries,
  );
  const areas: HailZoneOverlayArea[] = [];
  for (const geometry of geometries) {
    const postcode = geometry.properties?.postcode;
    if (typeof postcode !== "string") continue;
    const zone = zoneOf(postcode);
    if (zone == null) continue;
    const polygons = polygonsOf(geometry.type, geometry.arcs);
    if (!polygons) continue;

    const outPolygons: Position[][][] = [];
    for (const rings of polygons) {
      const outRings: Position[][] = [];
      for (const indices of rings) {
        if (!inRange(indices)) continue;
        let ring = buildRing(indices, simplified);
        // A tiny area can collapse to a line; keep its unsimplified outline.
        if (ring.length < 4) ring = buildRing(indices, topology.arcs);
        if (ring.length < 4) continue;
        outRings.push(ring.map(([lon, lat]) => [round(lon), round(lat)]));
      }
      if (outRings.length > 0) outPolygons.push(outRings);
    }
    if (outPolygons.length > 0)
      areas.push({ postcode, zone, polygons: outPolygons });
  }
  return areas;
}

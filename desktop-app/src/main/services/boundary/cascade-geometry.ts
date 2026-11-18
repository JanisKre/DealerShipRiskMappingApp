import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import { union } from "@turf/union";
import type { Feature, MultiPolygon, Polygon as GeoPolygon } from "geojson";
import type { BoundaryGeometry } from "@shared/types";
import {
  checkRing,
  distanceToRingM,
  projectPoint,
  ringAreaSqm,
  type LonLat,
} from "../boundary-geometry";

export const now = (): string => new Date().toISOString();

export function contains(ring: LonLat[], point: LonLat): boolean {
  try {
    return booleanPointInPolygon(point, {
      type: "Polygon",
      coordinates: [ring],
    });
  } catch {
    return false;
  }
}

export function geometryContains(
  geometry: BoundaryGeometry,
  point: LonLat,
): boolean {
  try {
    return booleanPointInPolygon(point, geometry);
  } catch {
    return false;
  }
}

export function distanceM(ring: LonLat[], point: LonLat): number {
  return contains(ring, point) ? 0 : distanceToRingM(point, ring);
}

export function metres(a: LonLat, b: LonLat): number {
  const [x, y] = projectPoint(b, a);
  return Math.hypot(x, y);
}

export function validRing(ring: LonLat[], maxAreaSqm: number): boolean {
  return (
    ring.length >= 4 && checkRing(ring, { minAreaSqm: 10, maxAreaSqm }).valid
  );
}

/** Union of rings, keeping every component and hole. */
export function unionRings(rings: LonLat[][]): BoundaryGeometry | null {
  if (rings.length === 0) return null;
  if (rings.length === 1) return { type: "Polygon", coordinates: [rings[0]] };
  let merged: Feature<GeoPolygon | MultiPolygon> = turfPolygon([rings[0]]);
  for (const ring of rings.slice(1)) {
    try {
      const next = union(featureCollection([merged, turfPolygon([ring])]));
      if (next) merged = next;
    } catch {
      // A malformed ring is skipped rather than losing the whole union.
    }
  }
  const geometry = merged.geometry;
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: geometry.coordinates as LonLat[][] }
    : {
        type: "MultiPolygon",
        coordinates: geometry.coordinates as LonLat[][][],
      };
}

/** Length of the minimum-area bounding rectangle, in metres. */
export function boundingLengthM(xy: Array<[number, number]>): number {
  return boundingBox(xy).length;
}

/**
 * Minimum-area bounding rectangle: its long side and the direction of that
 * side in radians, folded into [0, π).
 */
export function boundingBox(xy: Array<[number, number]>): {
  length: number;
  angle: number;
} {
  let bestArea = Infinity;
  let length = 0;
  let longAngle = 0;
  for (let i = 1; i < xy.length; i += 1) {
    const angle = Math.atan2(xy[i][1] - xy[i - 1][1], xy[i][0] - xy[i - 1][0]);
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const [x, y] of xy) {
      const u = x * c + y * s;
      const v = -x * s + y * c;
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
    }
    const a = maxU - minU;
    const b = maxV - minV;
    if (a * b < bestArea) {
      bestArea = a * b;
      length = Math.max(a, b);
      const axis = a >= b ? angle : angle + Math.PI / 2;
      longAngle = ((axis % Math.PI) + Math.PI) % Math.PI;
    }
  }
  return { length, angle: longAngle };
}

/** The same geometry without interior rings. */
export function withoutHoles(geometry: BoundaryGeometry): BoundaryGeometry {
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: [geometry.coordinates[0]] }
    : {
        type: "MultiPolygon",
        coordinates: geometry.coordinates.map((polygon) => [polygon[0]]),
      };
}

/** Every exterior ring of a geometry, holes dropped. */
function exteriorRings(geometry: BoundaryGeometry): LonLat[][] {
  return geometry.type === "Polygon"
    ? [geometry.coordinates[0] as LonLat[]]
    : geometry.coordinates.map((polygon) => polygon[0] as LonLat[]);
}

/** [minLon, minLat, maxLon, maxLat] over the exterior rings of a geometry. */
function geometryBounds(
  geometry: BoundaryGeometry,
): [number, number, number, number] {
  const boxes = exteriorRings(geometry).map((ring) => ringBounds(ring));
  return [
    Math.min(...boxes.map((b) => b[0])),
    Math.min(...boxes.map((b) => b[1])),
    Math.max(...boxes.map((b) => b[2])),
    Math.max(...boxes.map((b) => b[3])),
  ];
}

/**
 * Share of a ring's area that lies inside a geometry, sampled on a lattice
 * of about `samples` points (never coarser than the ring needs, never finer
 * than 0.75 m). 0 for a ring too small to sample.
 */
export function ringShareInside(
  ring: LonLat[],
  geometry: BoundaryGeometry,
  samples = 400,
): number {
  const [west, south, east, north] = ringBounds(ring);
  const [gw, gs, ge, gn] = geometryBounds(geometry);
  if (west > ge || east < gw || south > gn || north < gs) return 0;
  const stepM = Math.max(0.75, Math.sqrt(ringAreaSqm(ring) / samples));
  const dLat = stepM / 111_320;
  const dLon =
    dLat / Math.max(0.1, Math.cos((((south + north) / 2) * Math.PI) / 180));
  let total = 0;
  let inside = 0;
  for (let lat = south + dLat / 2; lat < north; lat += dLat) {
    for (let lon = west + dLon / 2; lon < east; lon += dLon) {
      const point: LonLat = [lon, lat];
      if (!contains(ring, point)) continue;
      total += 1;
      if (geometryContains(geometry, point)) inside += 1;
    }
  }
  return total === 0 ? 0 : inside / total;
}

/**
 * Buildings are not divided by a parcel line: a footprint that lies on the
 * given geometry by at least `minShare` of its area, and the footprint
 * `always` (the building at the point), is added whole. Footprints larger
 * than `maxBuildingSqm` are left alone, and nothing is added beyond
 * `maxAreaSqm` in total. The lines added are the footprints' own (cadastral
 * building outlines where the state publishes them); holes the union leaves
 * are filled.
 */
export function withWholeBuildings(
  geometry: BoundaryGeometry,
  buildings: LonLat[][],
  options: {
    minShare: number;
    minBuildingSqm: number;
    maxBuildingSqm: number;
    maxAreaSqm: number;
    always?: LonLat[];
  },
): { geometry: BoundaryGeometry; added: number } {
  const [gw, gs, ge, gn] = geometryBounds(geometry);
  const completed: LonLat[][] = [];
  for (const ring of buildings) {
    const [west, south, east, north] = ringBounds(ring);
    if (west > ge || east < gw || south > gn || north < gs) continue;
    const areaSqm = ringAreaSqm(ring);
    if (areaSqm < options.minBuildingSqm || areaSqm > options.maxBuildingSqm) {
      continue;
    }
    const share = ringShareInside(ring, geometry);
    // Inside already, but for the width of a line.
    if (share >= WHOLE_SHARE) continue;
    if (share >= options.minShare || (ring === options.always && share > 0)) {
      completed.push(ring);
    }
  }
  if (completed.length === 0) return { geometry, added: 0 };
  const union = unionRings([...exteriorRings(geometry), ...completed]);
  if (!union) return { geometry, added: 0 };
  const whole = withoutHoles(union);
  const areaSqm = exteriorRings(whole).reduce(
    (sum, ring) => sum + ringAreaSqm(ring),
    0,
  );
  return areaSqm > options.maxAreaSqm
    ? { geometry, added: 0 }
    : { geometry: whole, added: completed.length };
}

/** A footprint with this share inside is inside; the rest is line width. */
const WHOLE_SHARE = 0.98;

/**
 * Buildings a geometry cuts through: footprints of at least `minBuildingSqm`
 * with between `minShare` and `1 − minShare` of their area inside. Used to
 * measure results (boundary-replay.ts), not to form them.
 */
export function cutBuildings(
  geometry: BoundaryGeometry,
  buildings: LonLat[][],
  minBuildingSqm = 50,
  minShare = 0.15,
): Array<{ ring: LonLat[]; areaSqm: number; insideShare: number }> {
  const cut: Array<{ ring: LonLat[]; areaSqm: number; insideShare: number }> =
    [];
  for (const ring of buildings) {
    const areaSqm = ringAreaSqm(ring);
    if (areaSqm < minBuildingSqm) continue;
    const insideShare = ringShareInside(ring, geometry);
    if (insideShare >= minShare && insideShare <= 1 - minShare) {
      cut.push({ ring, areaSqm, insideShare });
    }
  }
  return cut;
}

/** Mean of a ring's vertices; inside for the compact rings of buildings. */
export function ringCentre(ring: LonLat[]): LonLat {
  const n = ring.length > 1 ? ring.length - 1 : ring.length;
  let lon = 0;
  let lat = 0;
  for (let i = 0; i < n; i += 1) {
    lon += ring[i][0];
    lat += ring[i][1];
  }
  return [lon / n, lat / n];
}

const boundsCache = new WeakMap<LonLat[], [number, number, number, number]>();

/** [minLon, minLat, maxLon, maxLat] of a ring, cached per ring. */
export function ringBounds(ring: LonLat[]): [number, number, number, number] {
  const hit = boundsCache.get(ring);
  if (hit) return hit;
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const [lon, lat] of ring) {
    minLon = Math.min(minLon, lon);
    minLat = Math.min(minLat, lat);
    maxLon = Math.max(maxLon, lon);
    maxLat = Math.max(maxLat, lat);
  }
  const bounds: [number, number, number, number] = [
    minLon,
    minLat,
    maxLon,
    maxLat,
  ];
  boundsCache.set(ring, bounds);
  return bounds;
}

/** A point inside the ring: its centre, or the centre of an inner corner. */
export function interiorPoint(ring: LonLat[]): LonLat {
  const centre = ringCentre(ring);
  if (contains(ring, centre)) return centre;
  for (let i = 0; i + 2 < ring.length; i += 1) {
    const corner: LonLat = [
      (ring[i][0] + ring[i + 1][0] + ring[i + 2][0]) / 3,
      (ring[i][1] + ring[i + 1][1] + ring[i + 2][1]) / 3,
    ];
    if (contains(ring, corner)) return corner;
  }
  return centre;
}

/** Octagon of `radiusM` around a point, closed. */
export function discRing(center: LonLat, radiusM: number): LonLat[] {
  const dLat = radiusM / 111_320;
  const dLon = dLat / Math.max(0.1, Math.cos((center[1] * Math.PI) / 180));
  const ring: LonLat[] = [];
  for (let i = 0; i <= 8; i += 1) {
    const a = (i / 8) * 2 * Math.PI;
    ring.push([center[0] + dLon * Math.cos(a), center[1] + dLat * Math.sin(a)]);
  }
  return ring;
}

import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { featureCollection, polygon as turfPolygon } from "@turf/helpers";
import { union } from "@turf/union";
import type { Feature, MultiPolygon, Polygon as GeoPolygon } from "geojson";
import type { BoundaryGeometry } from "@shared/types";
import {
  checkRing,
  distanceToRingM,
  projectPoint,
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

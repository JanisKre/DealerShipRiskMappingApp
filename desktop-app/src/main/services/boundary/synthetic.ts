import type { BoundaryResult } from "@shared/types";
import { polygonAreaSqm } from "../geo-math";

/**
 * Fallback radius (centre to corner of the octagon). Calibrated on the 17
 * public boundary fixtures so that the octagon around the point holds the
 * whole reference lot on at least 90% of them (16 of 17 at 160 m; 100 m held
 * 6 of 17). See docs/boundary-model.md, "Fallback circle".
 */
export const SYNTHETIC_BOUNDARY_RADIUS_M = 160;

/** Corners of the fallback shape: at most eight points to adjust. */
export const SYNTHETIC_BOUNDARY_VERTICES = 8;

const METRES_PER_DEGREE_LAT = 111_320;

export function syntheticFallbackBoundary(
  lat: number,
  lon: number,
  radiusM = SYNTHETIC_BOUNDARY_RADIUS_M,
): BoundaryResult {
  const steps = SYNTHETIC_BOUNDARY_VERTICES;
  const ring: [number, number][] = [];
  const dLat = radiusM / METRES_PER_DEGREE_LAT;
  const dLon =
    radiusM / (METRES_PER_DEGREE_LAT * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return {
    source: "synthetic",
    role: "synthetic",
    provider: "synthetic",
    polygon: { type: "Polygon", coordinates: [ring] },
    areaSqm: polygonAreaSqm(ring),
    confidence: 0.1,
  };
}

/**
 * Smallest fallback radius whose octagon around (lat, lon) holds every given
 * point. The octagon's sides lie at radius·cos(π/8) from the centre, along
 * the directions halfway between two corners, so a point at offset (x, y)
 * needs max over the eight side normals of (x, y)·n / cos(π/8). Uses the
 * same local projection as `syntheticFallbackBoundary`.
 */
export function syntheticRadiusToCover(
  lat: number,
  lon: number,
  points: ReadonlyArray<readonly [number, number]>,
): number {
  const steps = SYNTHETIC_BOUNDARY_VERTICES;
  const apothem = Math.cos(Math.PI / steps);
  const cosLat = Math.cos((lat * Math.PI) / 180);
  let radius = 0;
  for (const [pLon, pLat] of points) {
    const x = (pLon - lon) * METRES_PER_DEGREE_LAT * cosLat;
    const y = (pLat - lat) * METRES_PER_DEGREE_LAT;
    for (let k = 0; k < steps; k++) {
      const a = ((2 * k + 1) * Math.PI) / steps;
      radius = Math.max(radius, (x * Math.cos(a) + y * Math.sin(a)) / apothem);
    }
  }
  return radius;
}

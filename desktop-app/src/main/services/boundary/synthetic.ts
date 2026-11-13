import type { BoundaryResult } from "@shared/types";
import { polygonAreaSqm } from "../geo-math";

/** Calibrated fallback radius for typical dealership lots (90th-percentile coverage target). */
export const SYNTHETIC_BOUNDARY_RADIUS_M = 100;

export function syntheticFallbackBoundary(
  lat: number,
  lon: number,
  radiusM = SYNTHETIC_BOUNDARY_RADIUS_M,
): BoundaryResult {
  const steps = 8;
  const ring: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
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

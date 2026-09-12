import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { centroid } from "@turf/centroid";
import { polygon as turfPolygon } from "@turf/helpers";
import type { BoundaryResult } from "@shared/types";
import { cached, TTL } from "./cache.service";
import { fetchOverpass } from "./boundary.service";
import { polygonAreaSqm } from "./geo-math";

/**
 * Roof/building masking: estimates what share of a lot is built over by
 * buildings. Vehicles stand on the open area, not on
 * roofs — the built-over share therefore reduces the exposed vehicle area
 * (`exposureRatio` in `risk.service`).
 *
 * Data source: OSM buildings via Overpass (the same dependency-free source as
 * the boundary detection). Approximation: a building counts fully if its
 * centroid lies inside the lot boundary (no real polygon
 * clipping — sufficient for the ratio and robust without @turf/intersect).
 */

interface OverpassWay {
  geometry?: Array<{ lat: number; lon: number }>;
}

function bboxOf(ring: [number, number][]): {
  s: number;
  w: number;
  n: number;
  e: number;
} {
  let s = Infinity;
  let w = Infinity;
  let n = -Infinity;
  let e = -Infinity;
  for (const [lon, lat] of ring) {
    if (lat < s) s = lat;
    if (lat > n) n = lat;
    if (lon < w) w = lon;
    if (lon > e) e = lon;
  }
  return { s, w, n, e };
}

/**
 * Built-over area share (0..1) of the lot. When building data is missing
 * or an error occurs, 0 is returned (no masking — conservative).
 */
export async function roofCoverageRatio(
  boundary: BoundaryResult,
): Promise<number> {
  const raw = boundary.polygon.coordinates[0] as [number, number][];
  if (!raw || raw.length < 3 || boundary.areaSqm <= 0) return 0;
  // Defensively close the ring (turf.polygon requires first === last).
  const ring = [...raw];
  if (
    ring[0][0] !== ring[ring.length - 1][0] ||
    ring[0][1] !== ring[ring.length - 1][1]
  ) {
    ring.push(ring[0]);
  }
  if (ring.length < 4) return 0;

  const { s, w, n, e } = bboxOf(ring);
  const key = `roof:${s.toFixed(5)},${w.toFixed(5)},${n.toFixed(5)},${e.toFixed(5)}`;

  const ratio = await cached(key, TTL.buildings, async () => {
    const query = `
      [out:json][timeout:15];
      way(${s},${w},${n},${e})["building"];
      out geom;`;
    const data = await fetchOverpass<OverpassWay>(query);
    if (!data) return 0;

    const parcel = turfPolygon([ring]);
    let roofArea = 0;
    for (const el of data.elements) {
      if (!el.geometry || el.geometry.length < 3) continue;
      const bRing = el.geometry.map((p) => [p.lon, p.lat] as [number, number]);
      if (
        bRing[0][0] !== bRing[bRing.length - 1][0] ||
        bRing[0][1] !== bRing[bRing.length - 1][1]
      ) {
        bRing.push(bRing[0]);
      }
      // A building counts if its centroid lies inside the lot.
      const c = centroid(turfPolygon([bRing]));
      if (booleanPointInPolygon(c, parcel)) {
        roofArea += polygonAreaSqm(bRing);
      }
    }

    // Cap at the lot area (buildings can extend beyond the edge).
    return Math.min(1, roofArea / boundary.areaSqm);
  });

  return ratio ?? 0;
}

/**
 * Exposed area as a share of the lot (0..1): open (unbuilt)
 * area where vehicles stand. Clamped to [0.1, 1] so that degenerate
 * cases (boundary ≈ building footprint) don't push the EAL down to ~0.
 */
export async function exposureRatioForBoundary(
  boundary: BoundaryResult,
): Promise<number> {
  const roof = await roofCoverageRatio(boundary);
  return Math.max(0.1, Math.min(1, 1 - roof));
}

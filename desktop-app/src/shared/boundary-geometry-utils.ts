import type { BoundaryGeometry, Polygon } from "./types";
import area from "@turf/area";

export type LonLat = [number, number];
export type Ring = LonLat[];

/** Returns every exterior ring; holes are intentionally omitted. */
export function outerRings(geometry: BoundaryGeometry): Ring[] {
  return geometry.type === "Polygon"
    ? [geometry.coordinates[0] as Ring]
    : geometry.coordinates.map((part) => part[0] as Ring);
}

/** Returns every ring including holes, preserving GeoJSON nesting. */
export function polygonParts(geometry: BoundaryGeometry): Ring[][] {
  return geometry.type === "Polygon"
    ? [geometry.coordinates as Ring[]]
    : geometry.coordinates.map((part) => part as Ring[]);
}

/** Smallest lon/lat rectangle that contains every geometry component. */
export function geometryBbox(
  geometry: BoundaryGeometry,
): [number, number, number, number] {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const part of polygonParts(geometry)) {
    for (const ring of part) {
      for (const [lon, lat] of ring) {
        west = Math.min(west, lon);
        south = Math.min(south, lat);
        east = Math.max(east, lon);
        north = Math.max(north, lat);
      }
    }
  }
  return [west, south, east, north];
}

/** Backward-compatible main component for algorithms that require one ring. */
export function primaryOuterRing(geometry: BoundaryGeometry): Ring {
  const rings = outerRings(geometry);
  return rings[0] ?? [];
}

export function geometryAreaSqm(geometry: BoundaryGeometry): number {
  return area(geometry as never);
}

export function asPolygon(ring: Ring): Polygon {
  return { type: "Polygon", coordinates: [ring] };
}

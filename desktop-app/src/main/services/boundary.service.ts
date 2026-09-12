import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import type { BoundaryResult, Polygon } from "@shared/types";
import { cached, TTL } from "./cache.service";
import { fromAlkis } from "./alkis.service";
import { polygonAreaSqm } from "./geo-math";

/** Adapter contract for a parcel/building boundary source. */
export interface BoundaryProvider {
  readonly id: string;
  resolve(lat: number, lon: number): Promise<BoundaryResult | null>;
}

const BOUNDARY_PROVIDERS: BoundaryProvider[] = [
  { id: "alkis", resolve: fromAlkis },
  { id: "osm-landuse", resolve: fromOsm },
  { id: "osm-building", resolve: fromOsmBuildings },
];

/**
 * Lot boundary detection with a streamlined fallback chain:
 *   1. ALKIS (official German cadastral parcels)   — implemented, 7 of 16
 *      states (see alkis.service.ts — state determined offline via BBOX,
 *      no reverse-geocoding call needed anymore)
 *   2. OSM landuse/amenity via Overpass           — implemented (parcel)
 *   3. OSM building footprint via Overpass        — implemented (building)
 *   4. synthetic circle (always succeeds)
 *
 * On the "Overture" role (building footprint as fallback): instead of a heavy
 * DuckDB/Parquet dependency, the footprint is obtained from OSM buildings via Overpass
 * — the same HTTP+cache pattern as `fromOsm`, no native dep. The
 * enum value `overture` remains reserved for a future real Overture (with GERS ID)
 * integration; here the source is honestly `osm`, but with its own confidence.
 */
export async function detectBoundary(
  lat: number,
  lon: number,
): Promise<BoundaryResult> {
  // Parallel instead of sequential: the three sources are independent of each other
  // (no result is needed to query the next source) — sequential
  // awaits would here have only needlessly waited on three network round trips one after another.
  const candidates = await Promise.all(
    BOUNDARY_PROVIDERS.map((provider) => provider.resolve(lat, lon)),
  );
  const best = candidates
    .filter((c): c is BoundaryResult => c !== null)
    .sort((a, b) => b.confidence - a.confidence)[0];

  const result = best ?? syntheticCircle(lat, lon);
  return {
    ...result,
    evidence: result.evidence ?? {
      source: result.source.toUpperCase(),
      retrievedAt: new Date().toISOString(),
      method: result.source === "synthetic" ? "synthetic radius fallback" : "geospatial boundary lookup",
      confidence: result.confidence,
      fallbackUsed: result.source === "synthetic",
      limitations: result.source === "synthetic" ? ["Manual boundary review recommended"] : [],
    },
  };
}

// --- 1. ALKIS (implemented in alkis.service.ts) ------------------------
// State WFS in the AdV schema "ALKIS simplified"; see fromAlkis import above.

// --- Overpass call with mirror fallback ---------------------------------
// The public main instance is regularly overloaded (504) — on failure
// the load-balanced mirror is tried before the source is considered
// "nothing found" (instead of falling straight through to the synthetic circle).
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://lz4.overpass-api.de/api/interpreter",
];

export async function fetchOverpass<T>(
  query: string,
): Promise<{ elements: T[] } | null> {
  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: query,
      });
      if (!res.ok) continue;
      return (await res.json()) as { elements: T[] };
    } catch {
      // Network error → try the next mirror.
    }
  }
  return null;
}

// --- 2. OSM via Overpass (implemented) ---------------------------------
async function fromOsm(
  lat: number,
  lon: number,
): Promise<BoundaryResult | null> {
  const key = `osm:${lat.toFixed(5)},${lon.toFixed(5)}`;
  return cached(key, TTL.overpass, async () => {
    const query = `
      [out:json][timeout:15];
      (
        way(around:80,${lat},${lon})["landuse"];
        way(around:80,${lat},${lon})["amenity"];
      );
      out geom;`;
    const data = await fetchOverpass<{
      geometry?: Array<{ lat: number; lon: number }>;
    }>(query);
    if (!data) return null;
    const way = data.elements.find((e) => e.geometry && e.geometry.length >= 3);
    if (!way?.geometry) return null;

    const ring = way.geometry.map((p) => [p.lon, p.lat] as [number, number]);
    if (ring[0][0] !== ring[ring.length - 1][0]) ring.push(ring[0]);
    const polygon: Polygon = { type: "Polygon", coordinates: [ring] };

    return {
      source: "osm",
      polygon,
      areaSqm: polygonAreaSqm(ring),
      confidence: 0.6,
    };
  });
}

// --- 3. OSM building footprint via Overpass (implemented) --------------
// Fills the former "Overture" role dependency-free: building footprint from OSM.
// Picks the building that contains the point, otherwise the largest one in the vicinity.
async function fromOsmBuildings(
  lat: number,
  lon: number,
): Promise<BoundaryResult | null> {
  const key = `osmbuilding:${lat.toFixed(5)},${lon.toFixed(5)}`;
  return cached(key, TTL.buildings, async () => {
    const query = `
      [out:json][timeout:15];
      way(around:60,${lat},${lon})["building"];
      out geom;`;
    const data = await fetchOverpass<{
      geometry?: Array<{ lat: number; lon: number }>;
    }>(query);
    if (!data) return null;
    const rings = data.elements
      .filter((e) => e.geometry && e.geometry.length >= 3)
      .map((e) => {
        const ring = e.geometry!.map((p) => [p.lon, p.lat] as [number, number]);
        if (
          ring[0][0] !== ring[ring.length - 1][0] ||
          ring[0][1] !== ring[ring.length - 1][1]
        ) {
          ring.push(ring[0]);
        }
        return ring;
      });
    if (rings.length === 0) return null;

    // The building that contains the point takes priority; otherwise the largest one.
    const containing = rings.find((r) =>
      booleanPointInPolygon([lon, lat], { type: "Polygon", coordinates: [r] }),
    );
    const ring =
      containing ??
      rings.reduce((a, b) => (polygonAreaSqm(b) > polygonAreaSqm(a) ? b : a));

    return {
      source: "osm",
      polygon: { type: "Polygon", coordinates: [ring] } as Polygon,
      areaSqm: polygonAreaSqm(ring),
      confidence: 0.4, // building footprint (usually smaller than the lot)
    };
  });
}

// --- 4. Synthetic circle ----------------------------------------------
function syntheticCircle(
  lat: number,
  lon: number,
  radiusM = 50,
): BoundaryResult {
  const steps = 24;
  const ring: [number, number][] = [];
  const dLat = radiusM / 111_320;
  const dLon = radiusM / (111_320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    ring.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return {
    source: "synthetic",
    polygon: { type: "Polygon", coordinates: [ring] },
    areaSqm: Math.PI * radiusM * radiusM,
    confidence: 0.1,
  };
}

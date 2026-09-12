import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import type { BoundaryCandidate, BoundaryResult, Polygon } from "@shared/types";
import { cached, TTL } from "./cache.service";
import { fromAlkis } from "./alkis.service";
import { polygonAreaSqm } from "./geo-math";

/** Adapter contract for a parcel/building boundary source. */
export interface BoundaryProvider {
  readonly id: string;
  resolve(
    lat: number,
    lon: number,
    context?: BoundaryLookupContext,
  ): Promise<BoundaryResult | null>;
}

export interface BoundaryLookupContext {
  name?: string;
  address?: string;
}

const BOUNDARY_PROVIDERS: BoundaryProvider[] = [
  { id: "alkis", resolve: fromAlkis },
  { id: "osm-landuse", resolve: fromOsm },
  { id: "osm-building", resolve: fromOsmBuildings },
];

/**
 * Lot boundary detection with a multi-source candidate pipeline:
 *   1. ALKIS (official German cadastral parcels)   — implemented, 7 of 16
 *      states (see alkis.service.ts — state determined offline via BBOX,
 *      no reverse-geocoding call needed anymore)
 *   2. OSM landuse/amenity via Overpass           — implemented (parcel)
 *   3. OSM building footprint via Overpass        — implemented (building)
 *   4. synthetic octagonal fallback boundary (always succeeds)
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
  name?: string,
  address?: string,
): Promise<BoundaryResult> {
  const context = { name, address } satisfies BoundaryLookupContext;
  const candidates = await Promise.all(
    BOUNDARY_PROVIDERS.map((provider) => provider.resolve(lat, lon, context)),
  );
  const resolvedCandidates = candidates
    .filter((c): c is BoundaryResult => c !== null)
    .sort((a, b) => b.confidence - a.confidence)[0];

  const fallback = syntheticFallbackBoundary(lat, lon);
  const result = resolvedCandidates ?? fallback;
  const candidateSummaries = [
    ...candidates.filter((c): c is BoundaryResult => c !== null),
    fallback,
  ]
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 10)
    .map(toBoundaryCandidate);
  const reviewRequired =
    result.source === "synthetic" || result.confidence < 0.7;

  return {
    ...result,
    candidates: candidateSummaries,
    reviewRequired,
    evidence: result.evidence ?? {
      source: result.source.toUpperCase(),
      retrievedAt: new Date().toISOString(),
      method:
        result.source === "synthetic"
          ? "synthetic radius fallback"
          : "geospatial boundary lookup",
      confidence: result.confidence,
      fallbackUsed: result.source === "synthetic",
      limitations: reviewRequired
        ? ["Automatic boundary candidate; verify coverage before underwriting"]
        : [],
    },
  };
}

function toBoundaryCandidate(result: BoundaryResult): BoundaryCandidate {
  return {
    source: result.source,
    polygon: result.polygon,
    areaSqm: result.areaSqm,
    confidence: result.confidence,
    ...(result.label ? { label: result.label } : {}),
    ...(result.evidence ? { evidence: result.evidence } : {}),
  };
}

// --- 1. ALKIS (implemented in alkis.service.ts) ------------------------
// State WFS in the AdV schema "ALKIS simplified"; see fromAlkis import above.

// --- Overpass call with mirror fallback ---------------------------------
// The public main instance is regularly overloaded (504) — on failure
// the load-balanced mirror is tried before the source is considered
// "nothing found" (instead of falling straight through to the synthetic octagon).
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
  context?: BoundaryLookupContext,
): Promise<BoundaryResult | null> {
  const contextKey = normalizeSearchText(
    `${context?.name ?? ""} ${context?.address ?? ""}`,
  ).slice(0, 50);
  const key = `osm:${lat.toFixed(5)},${lon.toFixed(5)}:${contextKey}`;
  return cached(key, TTL.overpass, async () => {
    const query = `
      [out:json][timeout:20];
      (
        nwr(around:250,${lat},${lon})["amenity"="parking"];
        way(around:250,${lat},${lon})["landuse"~"^(retail|commercial)$"];
        way(around:250,${lat},${lon})["shop"="car"];
      );
      out geom tags;`;
    const data = await fetchOverpass<{
      geometry?: Array<{ lat: number; lon: number }>;
      tags?: Record<string, string>;
    }>(query);
    if (!data) return null;
    const ranked = data.elements
      .filter((e) => e.geometry && e.geometry.length >= 3)
      .map((element) => {
        const ring = closeRing(
          element.geometry!.map((p) => [p.lon, p.lat] as [number, number]),
        );
        return {
          ring,
          tags: element.tags ?? {},
          score: scoreOsmBoundary(element.tags ?? {}, ring, lat, lon, context),
        };
      })
      .sort((a, b) => b.score - a.score);
    const best = ranked[0];
    if (!best) return null;

    const polygon: Polygon = { type: "Polygon", coordinates: [best.ring] };
    const confidence = Math.min(0.86, Math.max(0.45, best.score));

    return {
      source: "osm",
      polygon,
      areaSqm: polygonAreaSqm(best.ring),
      confidence,
      ...(best.tags.name ? { label: best.tags.name } : {}),
      evidence: {
        source: "OpenStreetMap / Overpass",
        retrievedAt: new Date().toISOString(),
        method: "semantic parking, retail and car-dealer geometry ranking",
        confidence,
        fallbackUsed: false,
        limitations: [
          "OSM coverage and geometry quality vary by region",
          "Confirm that the selected polygon belongs to the dealership",
        ],
      },
    };
  });
}

interface OSMBoundaryTags {
  name?: string;
  brand?: string;
  amenity?: string;
  landuse?: string;
  shop?: string;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function scoreOsmBoundary(
  tags: OSMBoundaryTags,
  ring: [number, number][],
  lat: number,
  lon: number,
  context?: BoundaryLookupContext,
): number {
  const semantic =
    tags.amenity === "parking"
      ? 0.68
      : tags.shop === "car"
        ? 0.62
        : tags.landuse === "retail"
          ? 0.58
          : 0.5;
  const searchable = normalizeSearchText(
    `${tags.name ?? ""} ${tags.brand ?? ""}`,
  );
  const requested = normalizeSearchText(
    `${context?.name ?? ""} ${context?.address ?? ""}`,
  );
  const requestedTokens = requested
    .split(" ")
    .filter((token) => token.length >= 4);
  const nameMatch = requestedTokens.some((token) => searchable.includes(token));
  const contains = booleanPointInPolygon([lon, lat], {
    type: "Polygon",
    coordinates: [ring],
  });
  return Math.min(1, semantic + (nameMatch ? 0.16 : 0) + (contains ? 0.12 : 0));
}

function closeRing(ring: [number, number][]): [number, number][] {
  if (
    ring.length > 0 &&
    (ring[0][0] !== ring[ring.length - 1][0] ||
      ring[0][1] !== ring[ring.length - 1][1])
  ) {
    ring.push(ring[0]);
  }
  return ring;
}

// --- 3. OSM building footprint via Overpass (implemented) --------------
// Fills the former "Overture" role dependency-free: building footprint from OSM.
// Picks the building that contains the point, otherwise the largest one in the vicinity.
async function fromOsmBuildings(
  lat: number,
  lon: number,
  _context?: BoundaryLookupContext,
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
      label: "OSM building footprint",
      evidence: {
        source: "OpenStreetMap / Overpass",
        retrievedAt: new Date().toISOString(),
        method: "nearest building footprint fallback",
        confidence: 0.4,
        fallbackUsed: true,
        limitations: ["A building footprint is not a parking-lot boundary"],
      },
    };
  });
}

// --- 4. Synthetic fallback boundary -----------------------------------
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
    polygon: { type: "Polygon", coordinates: [ring] },
    areaSqm: polygonAreaSqm(ring),
    confidence: 0.1,
  };
}

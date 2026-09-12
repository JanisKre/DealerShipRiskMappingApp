import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import type {
  BoundaryCandidate,
  BoundaryGeometryRole,
  BoundaryResult,
  Polygon,
} from "@shared/types";
import { cached, TTL } from "./cache.service";
import { fromAlkis } from "./alkis.service";
import { polygonAreaSqm } from "./geo-math";
import {
  approximatePolygonIoU,
  checkRing,
  distanceToRingM,
  type LonLat,
} from "./boundary-geometry";
import { fromOverture } from "./overture.service";
import { fromAerialSurface } from "./surface-boundary.service";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type { RiskParameters } from "@shared/types";

/** Adapter contract for a parcel/building boundary source. */
export interface BoundaryProvider {
  readonly id: string;
  resolve(
    lat: number,
    lon: number,
    context?: BoundaryLookupContext,
  ): Promise<BoundaryResult | BoundaryResult[] | null>;
}

export interface BoundaryLookupContext {
  name?: string;
  address?: string;
  parameters?: RiskParameters;
}

const BOUNDARY_PROVIDERS: BoundaryProvider[] = [
  { id: "alkis", resolve: fromAlkis },
  { id: "osm-landuse", resolve: fromOsm },
  { id: "osm-building", resolve: fromOsmBuildings },
  { id: "overture", resolve: fromOverture },
];
const AERIAL_SURFACE_PROVIDER: BoundaryProvider = {
  id: "aerial-surface",
  resolve: fromAerialSurface,
};

/**
 * Lot boundary detection with a multi-source candidate pipeline:
 *   1. ALKIS (official German cadastral parcels)   — implemented, 7 of 16
 *      states (see alkis.service.ts — state determined offline via BBOX,
 *      no reverse-geocoding call needed anymore)
 *   2. OSM landuse/amenity via Overpass           — semantic parking candidate
 *   3. OSM building footprint via Overpass        — building candidate
 *   4. Overture Buildings via optional CLI        — independent building source
 *   5. aerial paved-surface baseline              — reviewable surface candidate
 *   6. synthetic octagonal fallback boundary     — always succeeds
 *
 * Overture is accessed through its official bbox-pruned CLI because Overture
 * publishes GeoParquet rather than a small REST endpoint. It remains optional
 * and degrades gracefully when the CLI is not installed.
 */
export async function detectBoundary(
  lat: number,
  lon: number,
  name?: string,
  address?: string,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): Promise<BoundaryResult> {
  const context = { name, address, parameters } satisfies BoundaryLookupContext;
  const settled = await Promise.allSettled(
    BOUNDARY_PROVIDERS.map((provider) => provider.resolve(lat, lon, context)),
  );
  const providerCandidates = settled.flatMap((entry, index) => {
    if (entry.status !== "fulfilled" || entry.value == null) return [];
    const values = Array.isArray(entry.value) ? entry.value : [entry.value];
    return values
      .filter((value): value is BoundaryResult => value != null)
      .map((value) => ({
        ...value,
        provider: value.provider ?? BOUNDARY_PROVIDERS[index].id,
      }));
  });

  const fallback = syntheticFallbackBoundary(
    lat,
    lon,
    parameters.syntheticBoundaryRadiusM,
  );
  const preliminary = rankCandidates(
    [...providerCandidates, fallback],
    lat,
    lon,
    parameters,
  );
  if (shouldRunAerialRefinement(preliminary, parameters)) {
    try {
      const aerial = await AERIAL_SURFACE_PROVIDER.resolve(lat, lon, context);
      const values =
        aerial == null ? [] : Array.isArray(aerial) ? aerial : [aerial];
      providerCandidates.push(
        ...values.map((value) => ({
          ...value,
          provider: value.provider ?? AERIAL_SURFACE_PROVIDER.id,
        })),
      );
    } catch {
      // Imagery is an enhancement; vector candidates remain usable offline.
    }
  }
  const ranked = rankCandidates(
    [...providerCandidates, fallback],
    lat,
    lon,
    parameters,
  );
  const result = ranked[0] ?? fallback;
  const top2Margin = ranked[1]
    ? Math.max(0, ranked[0].selectionScore - ranked[1].selectionScore)
    : 1;
  const providerErrors = settled.flatMap((entry, index) =>
    entry.status === "rejected"
      ? [`${BOUNDARY_PROVIDERS[index].id} provider failed`]
      : [],
  );
  const resultWithQuality: BoundaryResult = {
    ...result,
    confidence: result.confidence,
    quality: result.quality
      ? {
          ...result.quality,
          top2Margin,
          reasons: [...result.quality.reasons, ...providerErrors],
        }
      : undefined,
  };
  const candidateSummaries = [...ranked].slice(0, 10).map(toBoundaryCandidate);
  const reviewRequired =
    result.source === "synthetic" ||
    result.role !== "operationalLot" ||
    result.confidence < parameters.boundaryReviewConfidence ||
    top2Margin < parameters.boundaryReviewTop2Margin ||
    result.quality?.pointRelation === "outside" ||
    (result.quality?.sourceAgreement ?? 0) < parameters.boundaryReviewSourceAgreement ||
    (result.quality?.areaPlausibility ?? 0) < 0.5;

  return {
    ...resultWithQuality,
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
        ? [
            "Automatic boundary candidate; verify coverage before underwriting",
            ...(resultWithQuality.quality?.reasons.slice(0, 3) ?? []),
          ]
        : [],
    },
  };
}

function shouldRunAerialRefinement(
  candidates: RankedBoundary[],
  parameters: RiskParameters,
): boolean {
  const best = candidates[0];
  if (!best || best.source === "synthetic") return true;
  // A cadastral parcel is legal context, not a reliable operational footprint.
  // Always ask the aerial surface adapter to check it; dealerships frequently
  // occupy several adjacent parcels or only part of one parcel.
  if (best.source === "alkis" || best.role === "parcel") return true;
  // Semantic OSM parking polygons are useful priors but are frequently
  // incomplete (only one forecourt/parking island is mapped). Verify them
  // against the wider aerial surface footprint before accepting them.
  if (best.source === "aerial") return false;
  return (
    best.confidence < parameters.boundaryReviewConfidence + 0.08 ||
    (best.quality?.sourceAgreement ?? 0) < parameters.boundaryReviewSourceAgreement + 0.1 ||
    best.quality?.pointRelation !== "inside"
  );
}

interface RankedBoundary extends BoundaryResult {
  selectionScore: number;
}

function rankCandidates(
  candidates: BoundaryResult[],
  lat: number,
  lon: number,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): RankedBoundary[] {
  const prepared = candidates
    .map((candidate) => evaluateCandidate(candidate, lat, lon, parameters))
    .filter((candidate): candidate is RankedBoundary => candidate !== null);
  return prepared
    .map((candidate) => {
      const peers = prepared.filter(
        (other) => other !== candidate && other.provider !== candidate.provider,
      );
      const agreement = peers.reduce(
        (best, other) =>
          Math.max(
            best,
            approximatePolygonIoU(candidate.polygon, other.polygon),
          ),
        0,
      );
      const operationallyConfirmed =
        candidate.role === "parkingSurface" &&
        candidate.source !== "aerial" &&
        candidate.quality?.pointRelation === "inside" &&
        agreement >= 0.55;
      const role = operationallyConfirmed ? "operationalLot" : candidate.role;
      const quality = {
        ...candidate.quality!,
        sourceAgreement: agreement,
        boundaryFit: operationallyConfirmed
          ? 1
          : candidate.quality!.boundaryFit,
      };
      const roleWeight = roleSelectionWeight(role);
      const calibratedConfidence = Math.min(
        1,
        Math.max(
          0,
          candidate.confidence * 0.55 +
            (quality.pointRelation === "inside"
              ? 0.15
              : quality.pointRelation === "near"
                ? 0.07
                : 0) +
            quality.areaPlausibility * 0.1 +
            agreement * 0.15 +
            quality.boundaryFit * 0.05,
        ),
      );
      const pointScore =
        quality.pointRelation === "inside"
          ? 0.18
          : quality.pointRelation === "near"
            ? 0.08
            : 0;
      const selectionScore =
        calibratedConfidence * 0.45 +
        pointScore +
        quality.areaPlausibility * 0.12 +
        quality.boundaryFit * 0.1 +
        agreement * 0.15 +
        roleWeight * 0.2 +
        // Prefer a broad aerial surface footprint when available: parcel and
        // semantic OSM polygons are often legally/semantically valid but
        // incomplete for the operational dealership area.
        (candidate.source === "aerial" ? 0.08 : 0) -
        (candidate.role === "parcel" ? 0.04 : 0);
      return {
        ...candidate,
        role,
        confidence: calibratedConfidence,
        quality,
        selectionScore,
        evidence: candidate.evidence
          ? {
              ...candidate.evidence,
              confidence: calibratedConfidence,
            }
          : undefined,
      };
    })
    .sort((a, b) => b.selectionScore - a.selectionScore);
}

function evaluateCandidate(
  candidate: BoundaryResult,
  lat: number,
  lon: number,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): RankedBoundary | null {
  const ring = candidate.polygon.coordinates[0] as LonLat[];
  if (!Array.isArray(ring)) return null;
  let check: ReturnType<typeof checkRing>;
  try {
    check = checkRing(ring, {
      minAreaSqm: candidate.role === "building" ? 10 : 25,
      maxAreaSqm: 2_000_000,
    });
  } catch {
    return null;
  }
  if (!check.valid) return null;
  let inside = false;
  try {
    inside = booleanPointInPolygon([lon, lat], candidate.polygon);
  } catch {
    return null;
  }
  const pointDistanceM = distanceToRingM([lon, lat], ring);
  const pointRelation = inside
    ? "inside"
    : pointDistanceM <= parameters.boundaryNearPointDistanceM
      ? "near"
      : "outside";
  const areaPlausibility = areaPlausibilityScore(candidate.role, check.areaSqm);
  const boundaryFit =
    candidate.role === "operationalLot"
      ? 1
      : candidate.role === "parkingSurface"
        ? 0.8
        : candidate.role === "parcel"
          ? 0.35
          : candidate.role === "building"
            ? 0.2
            : 0;
  const reasons: string[] = [];
  if (candidate.role === "parcel")
    reasons.push("candidate is a cadastral parcel");
  if (candidate.role === "building")
    reasons.push("candidate is a building footprint");
  if (candidate.role === "synthetic") reasons.push("candidate is synthetic");
  if (!inside) reasons.push(`reference point is ${pointRelation}`);
  if (areaPlausibility < 0.5) reasons.push("candidate area is atypical");
  return {
    ...candidate,
    areaSqm: check.areaSqm,
    quality: {
      geometryValid: true,
      pointRelation,
      pointDistanceM,
      sourceAgreement: 0,
      areaPlausibility,
      boundaryFit,
      reasons,
    },
    selectionScore: 0,
  };
}

function roleSelectionWeight(role?: BoundaryGeometryRole): number {
  return role === "operationalLot"
    ? 1
    : role === "parkingSurface"
      ? 0.85
      : role === "parcel"
        ? 0.55
        : role === "building"
          ? 0.3
          : 0;
}

function areaPlausibilityScore(
  role: BoundaryGeometryRole | undefined,
  areaSqm: number,
): number {
  const [min, ideal, max] =
    role === "building"
      ? [20, 2_500, 50_000]
      : role === "parcel"
        ? [100, 5_000, 500_000]
        : [250, 8_000, 250_000];
  if (areaSqm < min || areaSqm > max) return 0;
  if (areaSqm <= ideal) return (areaSqm - min) / Math.max(1, ideal - min);
  return Math.max(0, 1 - (areaSqm - ideal) / Math.max(1, max - ideal));
}

function toBoundaryCandidate(result: BoundaryResult): BoundaryCandidate {
  return {
    source: result.source,
    role: result.role,
    provider: result.provider,
    polygon: result.polygon,
    areaSqm: result.areaSqm,
    confidence: result.confidence,
    quality: result.quality,
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
): Promise<BoundaryResult[] | null> {
  const contextKey = normalizeSearchText(
    `${context?.name ?? ""} ${context?.address ?? ""}`,
  ).slice(0, 50);
  const key = `osm:${lat.toFixed(5)},${lon.toFixed(5)}:${contextKey}`;
  return cached<BoundaryResult[] | null>(key, TTL.overpass, async () => {
    const query = `
      [out:json][timeout:20];
      (
        nwr(around:250,${lat},${lon})["amenity"="parking"];
        nwr(around:250,${lat},${lon})["site"="parking"];
        way(around:250,${lat},${lon})["parking"="surface"];
        nwr(around:250,${lat},${lon})["landuse"~"^(retail|commercial)$"];
        nwr(around:250,${lat},${lon})["shop"="car"];
      );
      out geom center tags;`;
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
    return ranked.slice(0, 5).map((candidate) => {
      const polygon: Polygon = {
        type: "Polygon",
        coordinates: [candidate.ring],
      };
      const confidence = Math.min(0.86, Math.max(0.45, candidate.score));
      const role = osmRole(candidate.tags);
      return {
        source: "osm",
        role,
        polygon,
        areaSqm: polygonAreaSqm(candidate.ring),
        confidence,
        ...(candidate.tags.name ? { label: candidate.tags.name } : {}),
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
      } satisfies BoundaryResult;
    });
  });
}

interface OSMBoundaryTags {
  name?: string;
  brand?: string;
  operator?: string;
  website?: string;
  amenity?: string;
  parking?: string;
  site?: string;
  "addr:street"?: string;
  "addr:housenumber"?: string;
  "addr:postcode"?: string;
  "addr:city"?: string;
  landuse?: string;
  shop?: string;
}

function osmRole(_tags: OSMBoundaryTags): "parkingSurface" {
  // OSM semantics identify a physical parking/retail object, not ownership.
  // Keep it below a confirmed operational-lot candidate until conflation or
  // imagery establishes that the surface belongs to the dealership.
  return "parkingSurface";
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
    tags.amenity === "parking" && tags.parking === "surface"
      ? 0.74
      : tags.amenity === "parking" || tags.site === "parking"
        ? 0.68
        : tags.shop === "car"
          ? 0.62
          : tags.landuse === "retail"
            ? 0.58
            : 0.5;
  const searchable = normalizeSearchText(
    `${tags.name ?? ""} ${tags.brand ?? ""} ${tags.operator ?? ""} ${tags.website ?? ""}`,
  );
  const requested = normalizeSearchText(
    `${context?.name ?? ""} ${context?.address ?? ""}`,
  );
  const requestedTokens = requested
    .split(" ")
    .filter((token) => token.length >= 4 && !OSM_STOPWORDS.has(token));
  const nameMatch = requestedTokens.some((token) =>
    searchable.split(" ").includes(token),
  );
  const postcode = extractPostcode(context?.address);
  const houseNumber = extractHouseNumber(context?.address);
  const addressMatch =
    Boolean(postcode && tags["addr:postcode"] === postcode) ||
    Boolean(houseNumber && tags["addr:housenumber"] === houseNumber);
  let contains = false;
  try {
    contains = booleanPointInPolygon([lon, lat], {
      type: "Polygon",
      coordinates: [ring],
    });
  } catch {
    contains = false;
  }
  return Math.min(
    1,
    semantic +
      (nameMatch ? 0.16 : 0) +
      (addressMatch ? 0.12 : 0) +
      (contains ? 0.12 : 0),
  );
}

const OSM_STOPWORDS = new Set([
  "auto",
  "gmbh",
  "ag",
  "kg",
  "strasse",
  "strasse",
  "deutschland",
]);

function extractPostcode(value?: string): string | undefined {
  return value?.match(/\b\d{5}\b/)?.[0];
}

function extractHouseNumber(value?: string): string | undefined {
  return value?.match(/\b\d+[a-z]?\b/i)?.[0].toLowerCase();
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
): Promise<BoundaryResult[] | null> {
  const key = `osmbuilding:${lat.toFixed(5)},${lon.toFixed(5)}`;
  return cached<BoundaryResult[] | null>(key, TTL.buildings, async () => {
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

    return rings
      .map((ring) => {
        const contains = booleanPointInPolygon([lon, lat], {
          type: "Polygon",
          coordinates: [ring],
        });
        const confidence = contains ? 0.5 : 0.35;
        return {
          source: "osm",
          role: "building",
          polygon: { type: "Polygon", coordinates: [ring] } as Polygon,
          areaSqm: polygonAreaSqm(ring),
          confidence,
          label: "OSM building footprint",
          evidence: {
            source: "OpenStreetMap / Overpass",
            retrievedAt: new Date().toISOString(),
            method: "building footprint candidate near dealership point",
            confidence,
            fallbackUsed: true,
            limitations: ["A building footprint is not a parking-lot boundary"],
          },
        } satisfies BoundaryResult;
      })
      .slice(0, 10);
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
    role: "synthetic",
    provider: "synthetic",
    polygon: { type: "Polygon", coordinates: [ring] },
    areaSqm: polygonAreaSqm(ring),
    confidence: 0.1,
  };
}

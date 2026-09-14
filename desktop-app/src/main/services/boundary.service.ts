import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import type {
  BoundaryCandidate,
  BoundaryEngine,
  BoundaryGeometryRole,
  BoundaryResult,
  Polygon,
} from "@shared/types";
import { fromAlkis } from "./alkis.service";
import { polygonAreaSqm } from "./geo-math";
import {
  geometryAreaSqm,
  outerRings,
  primaryOuterRing,
} from "@shared/boundary-geometry-utils";
import {
  approximatePolygonIoU,
  checkRing,
  distanceToRingM,
  type LonLat,
} from "./boundary-geometry";
import { fetchOsmEvidence } from "./boundary/osm-evidence.service";
import { fromNominatimPolygon } from "./boundary/nominatim-polygon";
import { collectEvidence } from "./boundary/evidence-sources";
import {
  buildResultFromFusion,
  FUSION_VERSION,
  fuseBoundary,
  layerDiversity,
} from "./boundary/fusion";
import { getSettings } from "./settings.service";
import { fromOverture } from "./overture.service";
import { fromAerialSurface } from "./surface-boundary.service";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { boundaryNeedsReview } from "@shared/boundary-review";
import type { RiskParameters } from "@shared/types";

export { fetchOverpass } from "./boundary/overpass-client";

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
  { id: "nominatim", resolve: fromNominatimPolygon },
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
 *   4. Nominatim address match with geometry      — identity-matched candidate
 *   5. Overture Buildings via optional CLI        — independent building source
 *   6. aerial paved-surface baseline              — reviewable surface candidate
 *   7. synthetic octagonal fallback boundary      — always succeeds
 *
 * Providers 2 and 3 share one cached Overpass round trip
 * (boundary/osm-evidence.service.ts), which also collects the barriers, roads
 * and address nodes the fusion engine needs.
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
  const attempt = await tryFusedBoundary(lat, lon, context, ranked, parameters);
  const fused = attempt.result;
  const result = fused ?? ranked[0] ?? fallback;
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
          // A fused result has no competing candidate to be close to; the
          // margin only describes the ranking it did not take part in.
          top2Margin: fused ? 1 : top2Margin,
          reasons: [...result.quality.reasons, ...providerErrors],
          requestedEngine: attempt.requestedEngine,
          usedEngine: attempt.usedEngine,
          ...(attempt.fallbackReason
            ? { fallbackReason: attempt.fallbackReason }
            : {}),
          resultVersion:
            attempt.usedEngine === "fused" ? FUSION_VERSION : LEGACY_RANKING_VERSION,
        }
      : undefined,
  };
  const candidateSummaries = [...ranked].slice(0, 10).map(toBoundaryCandidate);
  const reviewRequired = boundaryNeedsReview(resultWithQuality, parameters);

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

/** Bumped whenever the legacy candidate-ranking logic changes structurally. */
export const LEGACY_RANKING_VERSION = 1;

/**
 * Which engine actually produced a result, and — when it differs from what
 * was requested — why. Kept separate from the `BoundaryResult` itself so
 * `detectBoundary` can attach it to whichever result (fused or chain) it ends
 * up using.
 */
interface FusionAttempt {
  requestedEngine: BoundaryEngine;
  usedEngine: BoundaryEngine;
  fallbackReason?: string;
  result: BoundaryResult | null;
}

/**
 * Runs the evidence-fusion engine, when it is enabled and has something to work
 * with.
 *
 * Returns a null `result` in every failure mode — disabled, no evidence,
 * nothing defensible to grow from, or an outright error — so detection always
 * falls back to the candidate chain rather than to nothing. Fusion is an
 * improvement on the ranking, not a replacement for having an answer. The
 * `fallbackReason` records *why* whenever that happens despite fusion being
 * requested, for the diagnostics view.
 */
async function tryFusedBoundary(
  lat: number,
  lon: number,
  context: BoundaryLookupContext,
  ranked: RankedBoundary[],
  parameters: RiskParameters,
): Promise<FusionAttempt> {
  let engine: string | undefined;
  try {
    engine = getSettings().boundaryEngine;
  } catch {
    // Settings live in SQLite; if that is unavailable the legacy path still
    // works. There is no meaningful "requested" engine to report here.
    return {
      requestedEngine: "legacy",
      usedEngine: "legacy",
      fallbackReason: "settings unavailable",
      result: null,
    };
  }
  const requestedEngine: BoundaryEngine = engine === "fused" ? "fused" : "legacy";
  if (requestedEngine !== "fused") {
    return { requestedEngine, usedEngine: "legacy", result: null };
  }

  try {
    const bundle = await collectEvidence(lat, lon, {
      name: context.name,
      address: context.address,
      parameters,
    });
    const outcome = fuseBoundary(bundle, parameters);
    if (!outcome) {
      return {
        requestedEngine,
        usedEngine: "legacy",
        fallbackReason: "no defensible evidence to grow a site from",
        result: null,
      };
    }

    // Agreement against the independently-derived candidates, not against the
    // sources fusion already consumed — otherwise it would be corroborating
    // itself.
    const sourceAgreement = ranked.reduce(
      (best, candidate) =>
        candidate.source === "synthetic"
          ? best
          : Math.max(
              best,
              approximatePolygonIoU(outcome.polygon, candidate.polygon),
            ),
      0,
    );

    const result = buildResultFromFusion(outcome, parameters, {
      // Until perimeter support is computed from the barrier lines themselves,
      // report layer diversity in its place rather than an invented number.
      barrierSupport: layerDiversity(outcome.layers),
      cadastreSnapped: outcome.cadastre != null,
      parcelCount: outcome.cadastre?.parcelCount ?? bundle.parcels.length,
      areaPlausibility: areaPlausibilityScore("operationalLot", outcome.areaSqm),
      sourceAgreement,
    });
    return { requestedEngine, usedEngine: "fused", result };
  } catch (error) {
    return {
      requestedEngine,
      usedEngine: "legacy",
      fallbackReason: `fusion engine error: ${error instanceof Error ? error.message : "unknown"}`,
      result: null,
    };
  }
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
        (other) =>
          other !== candidate &&
          // The synthetic octagon is a circle drawn around the geocoded point.
          // It carries no information about the site, so any overlap with it is
          // an artefact of both shapes being near the same coordinate — it must
          // never read as a second opinion.
          other.source !== "synthetic" &&
          datasetOf(other) !== datasetOf(candidate),
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

/**
 * The underlying dataset a candidate came from.
 *
 * Source agreement is supposed to measure *independent* corroboration, and it
 * used to compare by provider id. But `osm-landuse`, `osm-building` and
 * `nominatim-polygon` are three views of one dataset — since the OSM providers
 * were merged they are literally three readings of the same Overpass response.
 * A parking polygon "agreeing" with a building footprint drawn by the same
 * mapper is not a second opinion, and counting it as one inflates confidence
 * exactly where the data is thinnest.
 */
function datasetOf(candidate: BoundaryResult): string {
  const provider = candidate.provider ?? candidate.source;
  if (candidate.source === "alkis" || provider.startsWith("alkis")) {
    return "alkis";
  }
  if (candidate.source === "osm" || provider === "nominatim-polygon") {
    return "osm";
  }
  // Overture buildings blend OSM with Microsoft and Esri footprints, so they
  // carry information OSM alone does not.
  return candidate.source;
}

function evaluateCandidate(
  candidate: BoundaryResult,
  lat: number,
  lon: number,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): RankedBoundary | null {
  const rings = outerRings(candidate.polygon) as LonLat[][];
  const ring = primaryOuterRing(candidate.polygon) as LonLat[];
  if (rings.length === 0 || ring.length < 4) return null;
  const [, , maxAreaSqm] = areaBoundsForRole(candidate.role);
  let areaSqm: number;
  try {
    const checks = rings.map((part) =>
      checkRing(part, {
        minAreaSqm: candidate.role === "building" ? 10 : 25,
        maxAreaSqm,
      }),
    );
    if (checks.some((part) => !part.valid)) return null;
    areaSqm = geometryAreaSqm(candidate.polygon);
    if (areaSqm <= 0 || areaSqm > maxAreaSqm) return null;
    /*
     * The per-component check rejects malformed rings; total area is then used
     * for the operational plausibility score so split facilities are not
     * silently reduced to their largest component.
     */
  } catch {
    return null;
  }
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
  const areaPlausibility = areaPlausibilityScore(candidate.role, areaSqm);
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
    areaSqm,
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

/** `[min, ideal, max]` plausible area in m² per geometry role. */
function areaBoundsForRole(
  role: BoundaryGeometryRole | undefined,
): [number, number, number] {
  return role === "building"
    ? [20, 2_500, 50_000]
    : role === "parcel"
      ? [100, 5_000, 500_000]
      : [250, 8_000, 250_000];
}

function areaPlausibilityScore(
  role: BoundaryGeometryRole | undefined,
  areaSqm: number,
): number {
  const [min, ideal, max] = areaBoundsForRole(role);
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

// --- 2. OSM semantic candidates (dealer / parking / land use) ----------
// Geometry comes from the shared evidence fetch, so this provider and the
// building provider below cost one Overpass round trip between them.
async function fromOsm(
  lat: number,
  lon: number,
  context?: BoundaryLookupContext,
): Promise<BoundaryResult[] | null> {
  const evidence = await fetchOsmEvidence(lat, lon);
  if (!evidence) return null;

  const ranked = evidence.areas
    .filter(
      (area) =>
        area.kind === "dealerArea" ||
        area.kind === "parking" ||
        area.kind === "landuse",
    )
    .map((area) => ({
      ring: area.ring,
      tags: area.tags,
      score: scoreOsmBoundary(area.tags, area.ring, lat, lon, context),
    }))
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return [];

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


// --- 3. OSM building footprints ---------------------------------------
// Reuses the same cached evidence fetch. Buildings mapped as multipolygon
// relations are now included; the old `way(...)["building"]` query could not
// see them at all, and its 60 m radius missed showrooms set back from the
// geocoded point.
async function fromOsmBuildings(
  lat: number,
  lon: number,
  _context?: BoundaryLookupContext,
): Promise<BoundaryResult[] | null> {
  const evidence = await fetchOsmEvidence(lat, lon);
  if (!evidence) return null;

  const buildings = evidence.areas.filter((area) => area.kind === "building");
  if (buildings.length === 0) return [];

  return buildings
    .map((area) => {
      const contains = booleanPointInPolygon([lon, lat], {
        type: "Polygon",
        coordinates: [area.ring],
      });
      const confidence = contains ? 0.5 : 0.35;
      return {
        source: "osm",
        role: "building",
        polygon: { type: "Polygon", coordinates: [area.ring] } as Polygon,
        areaSqm: polygonAreaSqm(area.ring),
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
    // Nearest-first, so the 10 kept are the ones plausibly on this site.
    .sort(
      (a, b) =>
        distanceToRingM([lon, lat], primaryOuterRing(a.polygon) as LonLat[]) -
        distanceToRingM([lon, lat], primaryOuterRing(b.polygon) as LonLat[]),
    )
    .slice(0, 10);
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

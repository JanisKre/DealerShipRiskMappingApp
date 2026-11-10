import type {
  BoundaryCandidate,
  BoundaryResult,
  RiskParameters,
} from "@shared/types";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { boundaryNeedsReview } from "@shared/boundary-review";
import { fetchParcelsNear, PARCEL_SEARCH_RADIUS_M } from "./alkis.service";
import { polygonAreaSqm } from "./geo-math";
import type { LonLat } from "./boundary-geometry";
import { osmEvidenceBy } from "./boundary/osm-evidence.service";
import {
  finalizeCascadeResult,
  runCascade,
  type CascadeStage,
} from "./boundary/cascade";

export { fetchOverpass } from "./boundary/overpass-client";

export interface BoundaryRunOptions {
  /**
   * Epoch ms after which the cascade stops waiting for OpenStreetMap. The
   * analysis passes "now", so only cached OSM is used and the request fills
   * the cache in the background. Without a deadline it waits (benchmark).
   */
  osmDeadline?: number;
}

/**
 * Lot boundary for one site: the source cascade (boundary/cascade.ts).
 *
 * `vehicles` are the georeferenced vehicle centres from the context image.
 * They decide how far the site reaches; without them the cascade can only
 * return a cached OSM dealer area, the parcel at the point or the circle.
 *
 * ALKIS and OSM are fetched once, in parallel, and both are cached.
 */
export async function detectBoundary(
  lat: number,
  lon: number,
  name?: string,
  address?: string,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
  vehicles: LonLat[] | null = null,
  options: BoundaryRunOptions = {},
): Promise<BoundaryResult> {
  const anchor: LonLat = [lon, lat];
  const [osmLookup, parcelLookup] = await Promise.all([
    osmEvidenceBy(lat, lon, options.osmDeadline),
    fetchParcelsNear(lat, lon, PARCEL_SEARCH_RADIUS_M).catch(() => null),
  ]);

  const cascade = runCascade({
    anchor,
    name,
    address,
    vehicles,
    osm: osmLookup.evidence,
    parcels: parcelLookup?.parcels ?? [],
    parameters,
  });
  const trace = [...cascade.trace];
  let chosen: { result: BoundaryResult; stage: CascadeStage } | null =
    cascade.result && cascade.stage
      ? { result: cascade.result, stage: cascade.stage }
      : null;
  if (!chosen) {
    trace.push("stage 5: synthetic circle around the point");
    chosen = {
      result: syntheticFallbackBoundary(
        lat,
        lon,
        parameters.syntheticBoundaryRadiusM,
      ),
      stage: 5,
    };
  }
  if (!vehicles) trace.push("no vehicle detection — re-analyse with a model");
  if (parcelLookup?.status === "transientFailure" || parcelLookup === null) {
    trace.push("cadastre service unreachable — re-analyse when online");
  }

  const result = finalizeCascadeResult(
    chosen.result,
    chosen.stage,
    anchor,
    cascade.alternatives,
    trace,
    parameters,
    vehicles,
  );
  const reviewRequired = boundaryNeedsReview(result, parameters);
  const synthetic = result.source === "synthetic";
  return {
    ...result,
    candidates: [result, ...cascade.alternatives]
      .slice(0, 10)
      .map(toBoundaryCandidate),
    reviewRequired,
    evidence: {
      ...(result.evidence ?? {
        source: result.source.toUpperCase(),
        retrievedAt: new Date().toISOString(),
        method: synthetic
          ? "synthetic radius fallback"
          : "geospatial boundary lookup",
        confidence: result.confidence,
        fallbackUsed: synthetic,
        limitations: [],
      }),
      fallbackUsed: synthetic || chosen.stage >= 4,
      limitations: [
        ...(result.evidence?.limitations ?? []),
        ...(reviewRequired
          ? [
              "Automatic boundary candidate; verify coverage before underwriting",
            ]
          : []),
      ],
    },
  };
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

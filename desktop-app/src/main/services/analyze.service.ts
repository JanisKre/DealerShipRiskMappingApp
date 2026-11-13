import type { AnalyzedDealership, DealershipInput } from "@shared/types";
import { hailZoneToRiskTier } from "@shared/risk-math";
import { lookupHailZone } from "@shared/hail-zones";
import { detectBoundary } from "./boundary.service";
import { osmEvidenceBy } from "./boundary/osm-evidence.service";
import { hasCustomOverpass } from "./boundary/overpass-client";
import {
  attachImageryProvenance,
  detectVehicles,
  detectVehiclesInContext,
  filterDetectionToBoundary,
} from "./detection.service";
import {
  maskRoofDetections,
  OFFICIAL_BUILDINGS_WAIT_MS,
} from "./detection/roof-mask.service";
import { booleanPointInPolygon } from "@turf/boolean-point-in-polygon";
import { boundaryNeedsReview } from "@shared/boundary-review";
import { imageryAgeYears } from "@shared/imagery-metadata";
import { fetchOfficialBuildings } from "./alkis-buildings.service";
import { bavariaStreetMask } from "./bavaria-landuse.service";
import { officialHouseCoordinate } from "./house-coordinates.service";
import {
  geocodeCandidates,
  isSitePoi,
  pickGeocodeHit,
} from "./geocoding.service";
import { websiteFromEvidence } from "./osmDetails.service";
import { scoreRisk } from "./risk.service";
import {
  aerialImageForContext,
  CONTEXT_CAPTURE_RADIUS_M,
  WIDE_CONTEXT_CAPTURE_RADIUS_M,
} from "./tiles.service";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type {
  BoundaryResult,
  BoundaryReviewFlag,
  DetectionResult,
  RiskParameters,
} from "@shared/types";
import type { LonLat } from "./boundary-geometry";
import { resolveNatCat } from "./natcat.service";

/** Extracts a 5-digit postal code from a German address string. */
function extractPostalCode(address: string | undefined): string | null {
  if (!address) return null;
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

/**
 * How long one analysis waits for OpenStreetMap. With only the public
 * Overpass servers: not at all — they are mostly at capacity, and the
 * boundary does not depend on OSM; cached OSM is used and the request fills
 * the cache in the background. With an own server (settings), which answers
 * in well under a second, the analysis waits briefly so roof mask, website
 * and the cached-OSM stage get fresh data.
 */
export const OSM_WAIT_MS = 0;
export const OSM_WAIT_OWN_SERVER_MS = 3_000;

/** Step durations of one analysis, logged so slow sites can be diagnosed. */
class StepTimer {
  private readonly started = Date.now();
  private readonly steps: string[] = [];

  async time<T>(label: string, work: Promise<T>): Promise<T> {
    const start = Date.now();
    try {
      return await work;
    } finally {
      this.steps.push(`${label} ${Date.now() - start} ms`);
    }
  }

  log(name: string): void {
    console.info(
      `Analysis '${name}': ${Date.now() - this.started} ms (${this.steps.join(", ")})`,
    );
  }
}

/**
 * Website for a location without one, from the OSM evidence the boundary
 * already waits for. Best effort: no OSM answer means no website.
 */
async function detectWebsite(
  lat: number,
  lon: number,
  input: DealershipInput,
  osmDeadline: number,
): Promise<string | undefined> {
  if (input.website) return undefined;
  const { evidence } = await osmEvidenceBy(lat, lon, osmDeadline);
  return evidence
    ? websiteFromEvidence(evidence, lat, lon, input.name, input.address)
    : undefined;
}

/**
 * Anchor for a record that has only an address. The name query often finds
 * the dealership POI where the address query only finds the street; both are
 * scored together (`pickGeocodeHit`), address hits first so ties keep the old
 * behaviour. The name query is best effort.
 *
 * Where the state publishes house coordinates, an exact match of street,
 * number and postcode near the pick replaces it: Nominatim often lands on
 * the street or interpolates the number. The dealership's own POI is kept,
 * since it marks the lot rather than the address building.
 */
async function geocodeDealership(
  address: string,
  name?: string,
): Promise<{ lat: number; lon: number; ambiguity?: string; source?: string }> {
  const byAddress = await geocodeCandidates(address);
  const byName = name
    ? await geocodeCandidates(`${name}, ${address}`).catch(() => [])
    : [];
  const pick = pickGeocodeHit([...byAddress, ...byName], { name, address });
  if (!pick) throw new Error(`Address could not be resolved: ${address}`);
  if (!isSitePoi(pick.hit, name)) {
    const official = await officialHouseCoordinate(address, pick.hit);
    if (official) {
      return {
        lat: official.lat,
        lon: official.lon,
        ambiguity: pick.ambiguity,
        source: `official house coordinate (ALKIS ${official.state})`,
      };
    }
  }
  return { lat: pick.hit.lat, lon: pick.hit.lon, ambiguity: pick.ambiguity };
}

/** Notes on the boundary's provenance where the anchor came from. */
function withAnchorSource(
  boundary: BoundaryResult,
  source: string | undefined,
): BoundaryResult {
  if (!source || !boundary.evidence) return boundary;
  return {
    ...boundary,
    evidence: {
      ...boundary.evidence,
      method: `${boundary.evidence.method}; anchor: ${source}`,
    },
  };
}

/** Records an ambiguous anchor on the boundary and sends it to review. */
function withAnchorAmbiguity(
  boundary: BoundaryResult,
  ambiguity: string | undefined,
): BoundaryResult {
  if (!ambiguity) return boundary;
  return {
    ...boundary,
    reviewRequired: true,
    ...(boundary.quality
      ? {
          quality: {
            ...boundary.quality,
            reasons: [...boundary.quality.reasons, ambiguity],
          },
        }
      : {}),
  };
}

/**
 * Core workflow for one record:
 *   (geocoding if needed) → aerial image → vehicle detection → boundary
 *   (the vehicles decide how far the lot reaches) → vehicles clipped to the
 *   boundary → risk. Website and NatCat run alongside.
 *
 * OSM is used only when cached (`OSM_WAIT_MS`), so a slow Overpass never
 * delays an analysis.
 */
export async function analyzeDealership(
  input: DealershipInput,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): Promise<AnalyzedDealership> {
  const timer = new StepTimer();
  let { lat, lon } = input;
  let anchorAmbiguity: string | undefined;
  let anchorSource: string | undefined;

  if ((lat == null || lon == null) && input.address) {
    const anchor = await timer.time(
      "geocode",
      geocodeDealership(input.address, input.name),
    );
    lat = anchor.lat;
    lon = anchor.lon;
    anchorAmbiguity = anchor.ambiguity;
    anchorSource = anchor.source;
  }
  if (lat == null || lon == null) {
    throw new Error(
      `No location for '${input.name}' (neither coordinates nor address)`,
    );
  }
  const siteLat = lat;
  const siteLon = lon;

  // Extract postal code from the address and look up the hail zone.
  const postalCode = extractPostalCode(input.address);
  const hailZone = postalCode ? lookupHailZone(postalCode) : null;

  const osmDeadline =
    Date.now() + (hasCustomOverpass() ? OSM_WAIT_OWN_SERVER_MS : OSM_WAIT_MS);
  // Started now so the official footprints are usually in by the time the
  // roof mask runs after imagery and detection; the mask joins this request.
  void fetchOfficialBuildings(siteLat, siteLon);
  // Bayern only: traffic areas for the outline, which has no street parcels
  // there. A no-op elsewhere; started now so it is in by the boundary step.
  void bavariaStreetMask(siteLat, siteLon);

  // Detection uses the whole context image, independently of the boundary
  // (P5): the vehicles are what the boundary is built from, so a boundary
  // must never decide which vehicles the model gets to see. Roofs are masked
  // first so a car park on a roof deck cannot pull the lot onto a building.
  const runContext = async (
    radiusM: number,
  ): Promise<{
    image: Awaited<ReturnType<typeof aerialImageForContext>>;
    detection: DetectionResult;
    boundary: BoundaryResult;
  }> => {
    const image = await timer.time(
      "imagery",
      aerialImageForContext(siteLat, siteLon, undefined, radiusM),
    );
    const detected = await timer.time(
      "detection",
      detectVehiclesInContext(image, parameters),
    );
    // The footprints were requested when the analysis started; give a slow
    // state service a bounded moment instead of silently skipping it.
    const buildingsDeadline = Date.now() + OFFICIAL_BUILDINGS_WAIT_MS;
    const detection = await timer.time(
      "roof mask",
      maskRoofDetections(
        detected,
        siteLat,
        siteLon,
        osmDeadline,
        buildingsDeadline,
      ),
    );
    const boundary = await timer.time(
      "boundary",
      detectBoundary(
        siteLat,
        siteLon,
        input.name,
        input.address,
        parameters,
        vehicleCentres(detection),
        { osmDeadline, buildingsDeadline },
      ),
    );
    return { image, detection, boundary };
  };
  // A lot that reaches the edge of the image may continue beyond it: capture
  // once more, wider, and decide again on the vehicles that image shows.
  const siteTask = (async () => {
    const normal = await runContext(CONTEXT_CAPTURE_RADIUS_M);
    if (!lotReachesImageEdge(normal.boundary, normal.detection, normal.image)) {
      return normal;
    }
    const wide = await runContext(WIDE_CONTEXT_CAPTURE_RADIUS_M).catch(
      () => null,
    );
    return wide ?? normal;
  })();
  // Resolved on every analysis, so a changed hail source (or a reset to
  // screening) takes effect and stale API values are never re-used. A failed
  // source falls back to screening.
  const [site, website, natCat] = await Promise.all([
    siteTask,
    detectWebsite(siteLat, siteLon, input, osmDeadline),
    timer.time("natcat", resolveNatCat(siteLat, siteLon)),
  ]);
  const context = site;
  const contextImage = site.image;
  const boundary = withImageryFlags(
    withAnchorSource(
      withAnchorAmbiguity(site.boundary, anchorAmbiguity),
      anchorSource,
    ),
    contextImage.imagery?.chosen.capturedAt ?? null,
    parameters,
  );

  // The boundary is applied only as a spatial filter, reusing the same
  // detection rather than re-running it.
  const detection = attachImageryProvenance(
    filterDetectionToBoundary(context.detection, boundary) ??
      (await maskRoofDetections(
        await detectVehicles(contextImage, boundary, parameters),
        siteLat,
        siteLon,
        osmDeadline,
      )),
    contextImage.imagery,
  );

  const risk = await scoreRisk(
    siteLat,
    siteLon,
    input.assetValue,
    detection,
    boundary,
    hailZone ?? undefined,
    parameters,
    natCat,
  );
  timer.log(input.name);

  const hailRiskTier = hailZone ? hailZoneToRiskTier(hailZone) : undefined;

  return {
    ...input,
    lat: siteLat,
    lon: siteLon,
    boundary,
    detection,
    risk,
    // Explicit, also when undefined: overrides a stale `natCat` from `input`.
    natCat,
    ...(website ? { website, websiteSource: "osm" as const } : {}),
    ...(hailZone != null ? { hailZone, hailRiskTier } : {}),
  };
}

/** Months whose imagery is flagged: long shadows hide parked vehicles. */
const WINTER_MONTHS = new Set([11, 12, 1, 2]);

/**
 * Imagery at least this old sends the boundary to review: a site may have
 * been built, extended or vacated since. Official orthophotos are flown
 * every two to three years, so four years means a fallback image (the
 * November audit found Esri 2020 imagery in Sachsen-Anhalt). The detail
 * view's softer age note starts at `IMAGERY_STALE_AFTER_YEARS`.
 */
export const STALE_IMAGERY_REVIEW_YEARS = 4;

/** Sends a boundary built on winter or stale imagery to review, with the reason. */
function withImageryFlags(
  boundary: BoundaryResult,
  capturedAt: string | null,
  parameters: RiskParameters,
  now: Date = new Date(),
): BoundaryResult {
  if (!capturedAt || !boundary.quality || boundary.source === "synthetic") {
    return boundary;
  }
  const added: Array<{ flag: BoundaryReviewFlag; reason: string }> = [];
  if (WINTER_MONTHS.has(Number(capturedAt.slice(5, 7)))) {
    added.push({
      flag: "winterImagery",
      reason: `imagery taken in winter (${capturedAt}); vehicles in shadow may be missing`,
    });
  }
  const age = imageryAgeYears(capturedAt, now);
  if (age >= STALE_IMAGERY_REVIEW_YEARS) {
    added.push({
      flag: "staleImagery",
      reason: `imagery is ${age} years old (${capturedAt}); the site may have changed`,
    });
  }
  const flags = boundary.quality.reviewFlags ?? [];
  const fresh = added.filter(({ flag }) => !flags.includes(flag));
  if (fresh.length === 0) return boundary;
  const next: BoundaryResult = {
    ...boundary,
    quality: {
      ...boundary.quality,
      reviewFlags: [...flags, ...fresh.map(({ flag }) => flag)],
      reasons: [
        ...boundary.quality.reasons,
        ...fresh.map(({ reason }) => reason),
      ],
    },
  };
  return {
    ...next,
    reviewRequired:
      boundary.reviewRequired === true || boundaryNeedsReview(next, parameters),
  };
}

/** Distance from the image edge within which lot vehicles count as touching it. */
const IMAGE_EDGE_MARGIN_M = 15;
/** Lot vehicles that must touch the edge before a wider capture is taken. */
const IMAGE_EDGE_MIN_VEHICLES = 3;

/**
 * True when at least `IMAGE_EDGE_MIN_VEHICLES` vehicles inside a lot from
 * stage 1 or 2 stand within `IMAGE_EDGE_MARGIN_M` of the image edge: the lot
 * probably continues outside the picture the boundary was built from.
 */
export function lotReachesImageEdge(
  boundary: BoundaryResult,
  detection: DetectionResult,
  image: { bbox: [number, number, number, number] },
): boolean {
  const stage = boundary.quality?.cascadeStage;
  if ((stage !== 1 && stage !== 2) || !image.bbox) return false;
  const [west, south, east, north] = image.bbox;
  const midLat = (south + north) / 2;
  const marginLat = IMAGE_EDGE_MARGIN_M / 111_320;
  const marginLon =
    IMAGE_EDGE_MARGIN_M / (111_320 * Math.cos((midLat * Math.PI) / 180));
  let touching = 0;
  for (const [lon, lat] of vehicleCentres(detection) ?? []) {
    const nearEdge =
      lon - west < marginLon ||
      east - lon < marginLon ||
      lat - south < marginLat ||
      north - lat < marginLat;
    if (!nearEdge) continue;
    if (booleanPointInPolygon([lon, lat], boundary.polygon)) touching += 1;
    if (touching >= IMAGE_EDGE_MIN_VEHICLES) return true;
  }
  return false;
}

/**
 * Georeferenced vehicle centres for the boundary. Null when the detector
 * produced no boxes (no model, no image) — the area-based fallback estimate
 * says nothing about where the vehicles stand.
 */
function vehicleCentres(detection: DetectionResult): LonLat[] | null {
  if (!detection.boxes) return null;
  return detection.boxes.flatMap((box) =>
    box.lon == null || box.lat == null ? [] : [[box.lon, box.lat] as LonLat],
  );
}

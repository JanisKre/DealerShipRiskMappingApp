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
import { maskRoofDetections } from "./detection/roof-mask.service";
import { geocodeCandidates, pickGeocodeHit } from "./geocoding.service";
import { websiteFromEvidence } from "./osmDetails.service";
import { scoreRisk } from "./risk.service";
import { aerialImageForContext } from "./tiles.service";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type {
  BoundaryResult,
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
 */
async function geocodeDealership(
  address: string,
  name?: string,
): Promise<{ lat: number; lon: number; ambiguity?: string }> {
  const byAddress = await geocodeCandidates(address);
  const byName = name
    ? await geocodeCandidates(`${name}, ${address}`).catch(() => [])
    : [];
  const pick = pickGeocodeHit([...byAddress, ...byName], { name, address });
  if (!pick) throw new Error(`Address could not be resolved: ${address}`);
  return { lat: pick.hit.lat, lon: pick.hit.lon, ambiguity: pick.ambiguity };
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

  if ((lat == null || lon == null) && input.address) {
    const anchor = await timer.time(
      "geocode",
      geocodeDealership(input.address, input.name),
    );
    lat = anchor.lat;
    lon = anchor.lon;
    anchorAmbiguity = anchor.ambiguity;
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

  // Detection uses the whole context image, independently of the boundary
  // (P5): the vehicles are what the boundary is built from, so a boundary
  // must never decide which vehicles the model gets to see. Roofs are masked
  // first so a car park on a roof deck cannot pull the lot onto a building.
  const contextTask = (async () => {
    const image = await timer.time(
      "imagery",
      aerialImageForContext(siteLat, siteLon),
    );
    const detected = await timer.time(
      "detection",
      detectVehiclesInContext(image, parameters),
    );
    const masked = await timer.time(
      "roof mask",
      maskRoofDetections(detected, siteLat, siteLon, osmDeadline),
    );
    return { image, detection: masked };
  })();
  const boundaryTask = contextTask.then(({ detection }) =>
    timer.time(
      "boundary",
      detectBoundary(
        siteLat,
        siteLon,
        input.name,
        input.address,
        parameters,
        vehicleCentres(detection),
        { osmDeadline },
      ),
    ),
  );
  // Resolved on every analysis, so a changed hail source (or a reset to
  // screening) takes effect and stale API values are never re-used. A failed
  // source falls back to screening.
  const [context, rawBoundary, website, natCat] = await Promise.all([
    contextTask,
    boundaryTask,
    detectWebsite(siteLat, siteLon, input, osmDeadline),
    timer.time("natcat", resolveNatCat(siteLat, siteLon)),
  ]);
  const contextImage = context.image;
  const boundary = withAnchorAmbiguity(rawBoundary, anchorAmbiguity);

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

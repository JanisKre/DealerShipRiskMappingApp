import type { AnalyzedDealership, DealershipInput } from "@shared/types";
import { hailZoneToRiskTier } from "@shared/risk-math";
import { lookupHailZone } from "@shared/hail-zones";
import { detectBoundary } from "./boundary.service";
import {
  attachImageryProvenance,
  detectVehicles,
  detectVehiclesInContext,
  filterDetectionToBoundary,
} from "./detection.service";
import { maskRoofDetections } from "./detection/roof-mask.service";
import { geocodeCandidates, pickGeocodeHit } from "./geocoding.service";
import { getOsmDetails } from "./osmDetails.service";
import { scoreRisk } from "./risk.service";
import { aerialImageForContext } from "./tiles.service";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type {
  BoundaryResult,
  DetectionResult,
  RiskParameters,
} from "@shared/types";
import type { VehicleEvidence } from "./boundary/fusion";
import { resolveNatCat } from "./natcat.service";

/** Extracts a 5-digit postal code from a German address string. */
function extractPostalCode(address: string | undefined): string | null {
  if (!address) return null;
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

/**
 * Website for a location without one, via the OSM dealership lookup (also
 * used by the detail view, so its cache serves both). Best effort: an
 * Overpass failure must never fail the analysis.
 */
async function detectWebsite(
  lat: number,
  lon: number,
  input: DealershipInput,
): Promise<string | undefined> {
  if (input.website) return undefined;
  try {
    return (await getOsmDetails(lat, lon, input.name, input.address)).website;
  } catch (error) {
    console.warn(`Website lookup failed for '${input.name}':`, error);
    return undefined;
  }
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
 *   (with the vehicles as evidence) → website → vehicles clipped to the
 *   boundary → risk.
 */
export async function analyzeDealership(
  input: DealershipInput,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): Promise<AnalyzedDealership> {
  let { lat, lon } = input;
  let anchorAmbiguity: string | undefined;

  if ((lat == null || lon == null) && input.address) {
    const anchor = await geocodeDealership(input.address, input.name);
    lat = anchor.lat;
    lon = anchor.lon;
    anchorAmbiguity = anchor.ambiguity;
  }
  if (lat == null || lon == null) {
    throw new Error(
      `No location for '${input.name}' (neither coordinates nor address)`,
    );
  }

  // Extract postal code from the address and look up the hail zone.
  const postalCode = extractPostalCode(input.address);
  const hailZone = postalCode ? lookupHailZone(postalCode) : null;

  // Context image and detection run before the boundary and independently
  // of it (P5): a too-tight boundary must not also hide vehicles from the
  // model, and the vehicles are evidence for the boundary itself. Roofs are
  // masked first so a car park on a roof deck cannot pull the lot onto a
  // building. Everything stays sequential, so one site never fires its
  // Overpass queries in parallel.
  const contextImage = await aerialImageForContext(lat, lon);
  const contextDetection = await maskRoofDetections(
    await detectVehiclesInContext(contextImage, parameters),
    lat,
    lon,
  );
  const boundary = withAnchorAmbiguity(
    await detectBoundary(
      lat,
      lon,
      input.name,
      input.address,
      parameters,
      vehicleEvidence(contextDetection),
    ),
    anchorAmbiguity,
  );
  const website = await detectWebsite(lat, lon, input);
  // The boundary is applied only as a spatial filter, reusing the same
  // detection rather than re-running it.
  const detection = attachImageryProvenance(
    filterDetectionToBoundary(contextDetection, boundary) ??
      (await maskRoofDetections(
        await detectVehicles(contextImage, boundary, parameters),
        lat,
        lon,
      )),
    contextImage.imagery,
  );
  // Resolved on every analysis, so a changed hail source (or a reset to
  // screening) takes effect and stale API values are never re-used. A failed
  // source falls back to screening.
  const natCat = await resolveNatCat(lat, lon);

  const risk = await scoreRisk(
    lat,
    lon,
    input.assetValue,
    detection,
    boundary,
    hailZone ?? undefined,
    parameters,
    natCat,
  );

  const hailRiskTier = hailZone ? hailZoneToRiskTier(hailZone) : undefined;

  return {
    ...input,
    lat,
    lon,
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
 * Georeferenced boxes as boundary evidence. Undefined when the detector
 * produced no boxes — the area-based fallback estimate is not evidence.
 */
function vehicleEvidence(
  detection: DetectionResult,
): VehicleEvidence[] | undefined {
  if (!detection.boxes) return undefined;
  return detection.boxes.flatMap((box) =>
    box.lon == null || box.lat == null
      ? []
      : [{ point: [box.lon, box.lat] as [number, number], score: box.score }],
  );
}

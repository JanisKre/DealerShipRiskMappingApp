import type { AnalyzedDealership, DealershipInput } from "@shared/types";
import { hailZoneToRiskTier } from "@shared/risk-math";
import { lookupHailZone } from "@shared/hail-zones";
import { detectBoundary } from "./boundary.service";
import { detectVehicles } from "./detection.service";
import { geocode } from "./geocoding.service";
import { scoreRisk } from "./risk.service";
import { aerialImageForBoundary } from "./tiles.service";

/** Extracts a 5-digit postal code from a German address string. */
function extractPostalCode(address: string | undefined): string | null {
  if (!address) return null;
  const match = address.match(/\b(\d{5})\b/);
  return match ? match[1] : null;
}

/**
 * Core workflow for one record:
 *   (geocoding if needed) → boundary → aerial image → vehicle detection → risk.
 */
export async function analyzeDealership(
  input: DealershipInput,
): Promise<AnalyzedDealership> {
  let { lat, lon } = input;

  if ((lat == null || lon == null) && input.address) {
    const hits = await geocode(input.address);
    if (hits.length === 0)
      throw new Error(`Address could not be resolved: ${input.address}`);
    lat = hits[0].lat;
    lon = hits[0].lon;
  }
  if (lat == null || lon == null) {
    throw new Error(
      `No location for '${input.name}' (neither coordinates nor address)`,
    );
  }

  // Extract postal code from the address and look up the hail zone.
  const postalCode = extractPostalCode(input.address);
  const hailZone = postalCode ? lookupHailZone(postalCode) : null;

  const boundary = await detectBoundary(lat, lon);
  const image = await aerialImageForBoundary(lat, lon, boundary);
  const detection = await detectVehicles(image, boundary);
  const risk = await scoreRisk(lat, lon, input.assetValue, detection, boundary, hailZone ?? undefined);

  const hailRiskTier = hailZone ? hailZoneToRiskTier(hailZone) : undefined;

  return {
    ...input,
    lat,
    lon,
    boundary,
    detection,
    risk,
    ...(hailZone != null ? { hailZone, hailRiskTier } : {}),
  };
}

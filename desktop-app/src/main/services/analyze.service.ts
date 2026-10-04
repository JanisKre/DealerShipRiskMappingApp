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
import { geocode } from "./geocoding.service";
import { scoreRisk } from "./risk.service";
import { aerialImageForContext } from "./tiles.service";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type { RiskParameters } from "@shared/types";
import { importedNatCat } from "@shared/natcat-routing";
import { resolveNatCat } from "./natcat.service";

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
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
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

  const boundary = await detectBoundary(
    lat,
    lon,
    input.name,
    input.address,
    parameters,
  );
  // Context image and first detection pass are deliberately independent of
  // the boundary just chosen (P5): a too-tight boundary must not also hide
  // vehicles from the model. The boundary is applied only as a spatial
  // filter afterwards, reusing the same detection rather than re-running it.
  const contextImage = await aerialImageForContext(lat, lon);
  const rawDetection = await detectVehiclesInContext(contextImage, parameters);
  const detection = attachImageryProvenance(
    filterDetectionToBoundary(rawDetection, boundary) ??
      (await detectVehicles(contextImage, boundary, parameters)),
    contextImage.imagery,
  );
  // Re-route on every analysis: only the import is kept from earlier runs,
  // so a changed routing (or a reset to screening) takes effect and stale API
  // values are never re-used. Failed sources fall back per peril.
  const natCatImport = importedNatCat(input);
  const natCat = await resolveNatCat(lat, lon, natCatImport);

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
    ...(natCatImport ? { natCatImport } : {}),
    ...(hailZone != null ? { hailZone, hailRiskTier } : {}),
  };
}

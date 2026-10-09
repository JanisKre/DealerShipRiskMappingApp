import type {
  DetectionResult,
  EalBreakdown,
  HailEalDetail,
  HailZone,
  NatCatAssessment,
  PerilScore,
} from "@shared/types";
import {
  computeHailEal,
  estimateHailZoneFromScore,
  hailVehicleBasis,
} from "@shared/risk-math";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type { RiskParameters } from "@shared/types";

export { RISK_MODEL_VERSION } from "@shared/constants";

/**
 * Hail zone for the EAL. A licensed provider's hail score is authoritative,
 * then the postcode table; without either, the zone is estimated from the
 * weather-based hail score and flagged as such.
 */
export function resolveHailZone(
  perils: PerilScore[],
  hailZone?: HailZone,
  natCat?: NatCatAssessment,
): { zone: HailZone; source: HailEalDetail["zoneSource"] } {
  const hailScore = perils.find((p) => p.peril === "hail")?.score ?? 0;
  if (natCat?.hazards.some((hazard) => hazard.peril === "hail")) {
    return { zone: estimateHailZoneFromScore(hailScore), source: "provider" };
  }
  if (hailZone != null) return { zone: hailZone, source: "postcode" };
  return { zone: estimateHailZoneFromScore(hailScore), source: "estimated" };
}

/**
 * Hail-only EAL (`EAL = N × λ_z × Σ p_k·S_k`). Other perils no longer feed
 * the loss figure; their scores remain available in `RiskAssessment.perils`.
 */
export function computeEalBreakdown(
  detection: DetectionResult | undefined,
  assetValue: number,
  exposureRatio: number,
  perils: PerilScore[],
  hailZone?: HailZone,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
  natCat?: NatCatAssessment,
): EalBreakdown {
  const { vehicles, source: vehicleSource } = hailVehicleBasis(
    detection,
    assetValue,
    parameters,
  );
  const { zone, source: zoneSource } = resolveHailZone(
    perils,
    hailZone,
    natCat,
  );
  const result = computeHailEal({ vehicles, exposureRatio, zone }, parameters);
  const hail = round(result.eal);
  return {
    hail,
    total: hail,
    hailDetail: {
      vehicles: round(vehicles),
      exposedVehicles: round(result.exposedVehicles),
      vehicleSource,
      zone,
      zoneSource,
      frequency: result.frequency,
      meanSeverityEur: round(result.meanSeverityEur),
    },
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

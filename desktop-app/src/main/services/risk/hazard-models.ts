import type { HailZone, NatCatAssessment, PerilScore } from "@shared/types";
import { hailZoneToScore } from "@shared/risk-math";
import type { WeatherMetrics } from "../weather.service";

/**
 * Hail score: a licensed provider's value, else the postcode hail zone, else
 * the weather-based CAPE proxy.
 */
export function scorePerils(
  w: WeatherMetrics,
  hailZone?: HailZone,
  natCat?: NatCatAssessment,
): PerilScore[] {
  const hail: PerilScore =
    hailZone != null
      ? {
          peril: "hail",
          score: clamp(hailZoneToScore(hailZone) * 100),
          hazardValue: hailZone,
          unit: "K-Kasko zone",
        }
      : {
          peril: "hail",
          score: clamp(w.hailProbability * 100),
          hazardValue: round(w.hailProbability * 100),
          unit: "%",
        };

  // A licensed NatCat assessment is authoritative for the hail indicator.
  // Keep the source observation in RiskAssessment.natCat; this array only
  // carries the normalized score used by the existing UI.
  const override = natCat?.hazards.find((hazard) => hazard.peril === "hail");
  if (override) {
    hail.score = override.score;
    hail.hazardValue = override.hazardValue ?? override.score;
    hail.unit = override.unit;
  }
  return [hail];
}

/** Returns the dealership's primary score: the hail score. */
export function primaryHailScore(perils: PerilScore[]): number {
  return perils.find((peril) => peril.peril === "hail")?.score ?? 0;
}

function clamp(n: number): number {
  return round(Math.max(0, Math.min(100, n)));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

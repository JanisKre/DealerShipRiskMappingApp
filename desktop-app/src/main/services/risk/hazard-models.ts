import type { HailZone, PerilScore } from "@shared/types";
import { hailZoneToScore } from "@shared/risk-math";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type { RiskParameters } from "@shared/types";
import type { WeatherMetrics } from "../weather.service";

export function scorePerils(
  w: WeatherMetrics,
  hailZone?: HailZone,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): PerilScore[] {
  return [
    {
      peril: "wind",
      score: clamp((w.maxWindKmh / parameters.windScoreMaxKmh) * 100),
      hazardValue: round(w.maxWindKmh),
      unit: "km/h",
    },
    {
      peril: "lightning",
      score: clamp((w.lightningDensity / parameters.lightningScoreMaxDensity) * 100),
      hazardValue: round(w.lightningDensity),
      unit: "strikes/km²/yr",
    },
    {
      peril: "snow",
      score: clamp((w.maxSnowDepthCm / parameters.snowScoreMaxCm) * 100),
      hazardValue: round(w.maxSnowDepthCm),
      unit: "cm",
    },
    {
      peril: "flood",
      score: clamp((w.annualPrecipMm / parameters.floodScoreMaxAnnualPrecipMm) * 100),
      hazardValue: round(w.annualPrecipMm),
      unit: "mm/a",
    },
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
        },
    {
      peril: "heat",
      score: clamp((w.hotDays / parameters.heatHotdaysScoreMax) * 100),
      hazardValue: round(w.hotDays),
      unit: "hot days/yr",
    },
  ];
}

/** Returns the configured primary dealership score from the peril results. */
export function primaryHailScore(perils: PerilScore[]): number {
  return perils.find((peril) => peril.peril === "hail")?.score ?? 0;
}

function clamp(n: number): number {
  return round(Math.max(0, Math.min(100, n)));
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

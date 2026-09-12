import type { EalBreakdown, HailZone } from "@shared/types";
import { hailZoneToScore } from "@shared/risk-math";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type { RiskParameters } from "@shared/types";
import type { WeatherMetrics } from "../weather.service";

export const RISK_MODEL_VERSION = "screening-0.3.0";

export function computeEalBreakdown(
  w: WeatherMetrics,
  exposure: number,
  exposureRatio: number,
  hailZone?: HailZone,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): EalBreakdown {
  if (exposure <= 0) {
    return { hail: 0, wind: 0, flood: 0, lightning: 0, snow: 0, heat: 0, total: 0 };
  }

  const baseFrequency = hailZone != null
    ? hailZoneToScore(hailZone) * 2
    : w.hailProbability * (1 + parameters.climateLoadingFactor);
  const hail = exposure * exposureRatio * Math.min(2, baseFrequency) *
    parameters.hailSiteHitProbability * parameters.hailDamageFraction;

  const stormDays = w.maxWindKmh >= parameters.windStormThresholdKmh
    ? Math.min(5, w.maxWindKmh / 30)
    : 0;
  const wind = exposure * exposureRatio * stormDays *
    parameters.windSiteHitProbability * parameters.windDamageFraction;

  // Screening proxy: replace this with a hydraulic/flood-hazard adapter when available.
  const floodReturnPeriod = w.annualPrecipMm > 1000 ? 20 : w.annualPrecipMm > 700 ? 50 : 100;
  const floodFraction = floodReturnPeriod <= 20
    ? parameters.floodDamageHq10
    : floodReturnPeriod <= 50
      ? parameters.floodDamageHq100
      : parameters.floodDamageHqExtrem;
  const flood = exposure * exposureRatio * (1 / floodReturnPeriod) * floodFraction;
  const lightning = exposure * exposureRatio * w.lightningDensity * parameters.lightningDensityScale * parameters.lightningDamageFraction;
  const snow = exposure * exposureRatio * (w.maxSnowDepthCm / 30) * parameters.snowLoadDamageFractionPer30cm;
  const heat = exposure * exposureRatio * w.hotDays * parameters.heatDamageFractionPerHotday;
  const total = hail + wind + flood + lightning + snow + heat;

  return {
    hail: round(hail),
    wind: round(wind),
    flood: round(flood),
    lightning: round(lightning),
    snow: round(snow),
    heat: round(heat),
    total: round(total),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

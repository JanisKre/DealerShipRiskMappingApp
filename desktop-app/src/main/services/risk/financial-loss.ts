import type { EalBreakdown, HailZone } from "@shared/types";
import {
  CLIMATE_LOADING_FACTOR,
  HAIL_DAMAGE_FRACTION_BASE,
  HEAT_DAMAGE_FRACTION_PER_HOTDAY,
  LIGHTNING_DAMAGE_FRACTION,
  SITE_HIT_PROBABILITY,
  SNOW_LOAD_DAMAGE_FRACTION_PER_30CM,
  WIND_DAMAGE_FRACTION,
  WIND_SITE_HIT_PROBABILITY,
  WIND_STORM_THRESHOLD_KMH,
} from "@shared/constants";
import { hailZoneToScore } from "@shared/risk-math";
import type { WeatherMetrics } from "../weather.service";

export const RISK_MODEL_VERSION = "screening-0.3.0";

export function computeEalBreakdown(
  w: WeatherMetrics,
  exposure: number,
  exposureRatio: number,
  hailZone?: HailZone,
): EalBreakdown {
  if (exposure <= 0) {
    return { hail: 0, wind: 0, flood: 0, lightning: 0, snow: 0, heat: 0, total: 0 };
  }

  const baseFrequency = hailZone != null
    ? hailZoneToScore(hailZone) * 2
    : w.hailProbability * (1 + CLIMATE_LOADING_FACTOR);
  const hail = exposure * exposureRatio * Math.min(2, baseFrequency) *
    SITE_HIT_PROBABILITY * HAIL_DAMAGE_FRACTION_BASE;

  const stormDays = w.maxWindKmh >= WIND_STORM_THRESHOLD_KMH
    ? Math.min(5, w.maxWindKmh / 30)
    : 0;
  const wind = exposure * exposureRatio * stormDays *
    WIND_SITE_HIT_PROBABILITY * WIND_DAMAGE_FRACTION;

  // Screening proxy: replace this with a hydraulic/flood-hazard adapter when available.
  const floodReturnPeriod = w.annualPrecipMm > 1000 ? 20 : w.annualPrecipMm > 700 ? 50 : 100;
  const flood = exposure * exposureRatio * (1 / floodReturnPeriod) * 0.15;
  const lightning = exposure * exposureRatio * w.lightningDensity * 0.001 * LIGHTNING_DAMAGE_FRACTION;
  const snow = exposure * exposureRatio * (w.maxSnowDepthCm / 30) * SNOW_LOAD_DAMAGE_FRACTION_PER_30CM;
  const heat = exposure * exposureRatio * w.hotDays * HEAT_DAMAGE_FRACTION_PER_HOTDAY;
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

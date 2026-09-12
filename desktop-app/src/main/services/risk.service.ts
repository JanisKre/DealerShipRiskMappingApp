import type {
  BoundaryResult,
  DetectionResult,
  EalBreakdown,
  HailZone,
  PerilScore,
  RiskAssessment,
} from "@shared/types";
import {
  hailZoneToScore,
} from "@shared/risk-math";
import {
  CAPACITY_SQM_PER_VEHICLE,
  CLIMATE_LOADING_FACTOR,
  HAIL_DAMAGE_FRACTION_BASE,
  HEAT_DAMAGE_FRACTION_PER_HOTDAY,
  HEAT_HOTDAYS_SCORE_MAX,
  LIGHTNING_DAMAGE_FRACTION,
  SITE_HIT_PROBABILITY,
  SNOW_LOAD_DAMAGE_FRACTION_PER_30CM,
  VEHICLE_VALUE_DEFAULT_EUR,
  VEHICLE_VALUE_EUR,
  WIND_DAMAGE_FRACTION,
  WIND_SITE_HIT_PROBABILITY,
  WIND_STORM_THRESHOLD_KMH,
} from "@shared/constants";
import { fetchWeather, type WeatherMetrics } from "./weather.service";
import { exposureRatioForBoundary } from "./roof.service";

/**
 * Risk scoring across the six perils. Each peril function maps a
 * physical hazard value onto a 0..100 score (higher = riskier).
 * The overall score is the weighted average.
 *
 * Additionally: exposure (vehicle value on-site from the detection), utilisation
 * (vehicles / parking capacity), and an EAL breakdown per peril in EUR/year
 * — formulas ported from the original `riskScoring.ts` (`calcEalComponents`),
 * reduced to the weather metrics available here.
 */

const WEIGHTS: Record<PerilScore["peril"], number> = {
  wind: 0.24,
  lightning: 0.1,
  snow: 0.14,
  flood: 0.28,
  hail: 0.19,
  heat: 0.05,
};

export async function scoreRisk(
  lat: number,
  lon: number,
  assetValue = 0,
  detection?: DetectionResult,
  boundary?: BoundaryResult,
  hailZone?: HailZone,
): Promise<RiskAssessment> {
  // Weather and roof exposure are independent of each other (neither result
  // is needed for the other request) → parallel instead of sequential.
  const [w, exposureRatio] = await Promise.all([
    fetchWeather(lat, lon),
    boundary ? exposureRatioForBoundary(boundary) : Promise.resolve(1),
  ]);

  const perils: PerilScore[] = [
    windScore(w),
    lightningScore(w),
    snowScore(w),
    floodScore(w),
    hailZone != null ? hailScoreFromZone(hailZone) : hailScore(w),
    heatScore(w),
  ];

  const overallScore = perils.reduce(
    (acc, p) => acc + p.score * WEIGHTS[p.peril],
    0,
  );

  // --- Exposure & capacity ---
  const exposureEur = estimatedExposureEur(detection, assetValue);
  const exposureAreaSqm = boundary?.areaSqm ?? 0;
  const capacityEstimate =
    exposureAreaSqm > 0
      ? Math.max(1, exposureAreaSqm / CAPACITY_SQM_PER_VEHICLE)
      : 0;
  const carCount = detection?.vehicleCount ?? 0;
  const utilisation = capacityEstimate > 0 ? carCount / capacityEstimate : 0;

  // exposureRatio (fetched above in parallel with fetchWeather): share of the open
  // (unbuilt) area where vehicles stand — built-over roof areas
  // (OSM buildings) reduce the exposure. Without a boundary, conservatively 1 (no masking).
  const ealBreakdown = computeEalBreakdown(w, exposureEur, exposureRatio, hailZone);
  const eal = ealBreakdown.total;

  return {
    overallScore: round(overallScore),
    perils,
    eal: round(eal),
    ealBreakdown,
    exposureEur: round(exposureEur),
    utilisation: round(utilisation),
    capacityEstimate: Math.round(capacityEstimate),
    computedAt: new Date().toISOString(),
  };
}

/** Vehicle value on-site from the class count (fallback: asset value). */
function estimatedExposureEur(
  detection: DetectionResult | undefined,
  assetValue: number,
): number {
  if (detection?.classCounts) {
    const c = detection.classCounts;
    const total = c.car + c.van + c.truck + c.bus;
    if (total > 0) {
      return (
        c.car * VEHICLE_VALUE_EUR.car +
        c.van * VEHICLE_VALUE_EUR.van +
        c.truck * VEHICLE_VALUE_EUR.truck +
        c.bus * VEHICLE_VALUE_EUR.bus
      );
    }
  }
  if (detection && detection.vehicleCount > 0) {
    return detection.vehicleCount * VEHICLE_VALUE_DEFAULT_EUR;
  }
  return assetValue;
}

/**
 * EAL per peril in EUR/year. Translates the original formulas to the weather
 * metrics available here (Open-Meteo + latitude heuristics).
 * If `hailZone` is given, the hail frequency is computed zone-based.
 */
function computeEalBreakdown(
  w: WeatherMetrics,
  exposure: number,
  exposureRatio: number,
  hailZone?: HailZone,
): EalBreakdown {
  if (exposure <= 0) {
    return {
      hail: 0,
      wind: 0,
      flood: 0,
      lightning: 0,
      snow: 0,
      heat: 0,
      total: 0,
    };
  }

  // Hail: zone-based frequency if available, otherwise weather heuristic.
  // zone_score (0..1) serves directly as an annual event-frequency approximation.
  const baseFrequency = hailZone != null
    ? hailZoneToScore(hailZone) * 2        // zone 1=0, zone 6=2 events/year
    : w.hailProbability * (1 + CLIMATE_LOADING_FACTOR);
  const adjFrequency = Math.min(2, baseFrequency);
  const hail =
    exposure *
    exposureRatio *
    adjFrequency *
    SITE_HIT_PROBABILITY *
    HAIL_DAMAGE_FRACTION_BASE;

  // Wind: storm days (maxWind above threshold → rough day-count approximation).
  const stormDays =
    w.maxWindKmh >= WIND_STORM_THRESHOLD_KMH
      ? Math.min(5, w.maxWindKmh / 30)
      : 0;
  const wind =
    exposure *
    exposureRatio *
    stormDays *
    WIND_SITE_HIT_PROBABILITY *
    WIND_DAMAGE_FRACTION;

  // Flood: annual precipitation → rough return-period approximation + damage fraction.
  let floodReturnPeriod = 100;
  if (w.annualPrecipMm > 1000) floodReturnPeriod = 20;
  else if (w.annualPrecipMm > 700) floodReturnPeriod = 50;
  const floodDamageFraction = 0.15;
  const flood =
    exposure * exposureRatio * (1 / floodReturnPeriod) * floodDamageFraction;

  // Lightning: lightning density × approximation factor × damage fraction.
  const lightning =
    exposure *
    exposureRatio *
    w.lightningDensity *
    0.001 *
    LIGHTNING_DAMAGE_FRACTION;

  // Snow load: max. snow depth / 30 cm × damage fraction.
  const snow =
    exposure *
    exposureRatio *
    (w.maxSnowDepthCm / 30) *
    SNOW_LOAD_DAMAGE_FRACTION_PER_30CM;

  // Heat: hot days/year × moderate damage fraction (battery/interior/paint).
  const heat =
    exposure * exposureRatio * w.hotDays * HEAT_DAMAGE_FRACTION_PER_HOTDAY;

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

function windScore(w: WeatherMetrics): PerilScore {
  return {
    peril: "wind",
    score: clamp((w.maxWindKmh / 120) * 100),
    hazardValue: round(w.maxWindKmh),
    unit: "km/h",
  };
}

function lightningScore(w: WeatherMetrics): PerilScore {
  return {
    peril: "lightning",
    score: clamp((w.lightningDensity / 5) * 100),
    hazardValue: round(w.lightningDensity),
    unit: "strikes/km²/yr",
  };
}

function snowScore(w: WeatherMetrics): PerilScore {
  return {
    peril: "snow",
    score: clamp((w.maxSnowDepthCm / 50) * 100),
    hazardValue: round(w.maxSnowDepthCm),
    unit: "cm",
  };
}

function floodScore(w: WeatherMetrics): PerilScore {
  return {
    peril: "flood",
    score: clamp((w.annualPrecipMm / 1200) * 100),
    hazardValue: round(w.annualPrecipMm),
    unit: "mm/a",
  };
}

function hailScore(w: WeatherMetrics): PerilScore {
  return {
    peril: "hail",
    score: clamp(w.hailProbability * 100),
    hazardValue: round(w.hailProbability * 100),
    unit: "%",
  };
}

/** Zone-based hail score: (zone − 1) / 5 × 100. */
function hailScoreFromZone(zone: HailZone): PerilScore {
  const score = hailZoneToScore(zone) * 100;
  return {
    peril: "hail",
    score: clamp(score),
    hazardValue: zone,
    unit: "K-Kasko zone",
  };
}

function heatScore(w: WeatherMetrics): PerilScore {
  return {
    peril: "heat",
    score: clamp((w.hotDays / HEAT_HOTDAYS_SCORE_MAX) * 100),
    hazardValue: round(w.hotDays),
    unit: "hot days/yr",
  };
}

function clamp(n: number): number {
  return round(Math.max(0, Math.min(100, n)));
}
function round(n: number): number {
  return Math.round(n * 100) / 100;
}

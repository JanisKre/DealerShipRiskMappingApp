import type {
  BoundaryResult,
  DetectionResult,
  HailZone,
  NatCatAssessment,
  RiskAssessment,
} from "@shared/types";
import { exposureRatioForBoundary } from "./roof.service";
import {
  fetchWeather,
  NEUTRAL_WEATHER_METRICS,
  openMeteoProvider,
} from "./weather.service";
import { capacityForArea, estimatedExposureEur } from "./risk/exposure";
import { riskEvidence, riskLimitations } from "./risk/evidence";
import { computeEalBreakdown, RISK_MODEL_VERSION } from "./risk/financial-loss";
import { primaryHailScore, scorePerils } from "./risk/hazard-models";
import { effectiveVehicleCount } from "@shared/risk-math";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type { RiskParameters } from "@shared/types";

/**
 * Orchestrator for the risk pipeline:
 * hazard → exposure → vulnerability/financial loss → portfolio output.
 * The individual layers live under ./risk so provider and model changes do
 * not require changes in the IPC or renderer layers.
 */
export async function scoreRisk(
  lat: number,
  lon: number,
  assetValue = 0,
  detection?: DetectionResult,
  boundary?: BoundaryResult,
  hailZone?: HailZone,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
  natCat?: NatCatAssessment,
): Promise<RiskAssessment> {
  let weatherFallbackUsed = false;
  const [weather, exposureRatio] = await Promise.all([
    fetchWeather(lat, lon).catch((error: unknown) => {
      // A transient Open-Meteo failure (outage, rate limit, timeout) must
      // degrade the weather-driven score, not abort the whole analysis —
      // boundary detection and vehicle counting already succeeded by now.
      console.warn("Weather lookup failed; using a neutral fallback", error);
      weatherFallbackUsed = true;
      return NEUTRAL_WEATHER_METRICS;
    }),
    boundary ? exposureRatioForBoundary(boundary) : Promise.resolve(1),
  ]);

  const perils = scorePerils(weather, hailZone, parameters, natCat);
  // The dealership's primary score is intentionally hail-only for now.
  // Keep the other peril scores available for optional detail views and
  // future score configuration without mixing them into the main score.
  const overallScore = primaryHailScore(perils);

  const exposureEur = estimatedExposureEur(detection, assetValue, parameters);
  const exposureAreaSqm = boundary?.areaSqm ?? 0;
  const capacityEstimate = capacityForArea(exposureAreaSqm, parameters);
  const carCount = effectiveVehicleCount(detection);
  const utilisation = capacityEstimate > 0 ? carCount / capacityEstimate : 0;
  const ealBreakdown = computeEalBreakdown(
    weather,
    exposureEur,
    exposureRatio,
    hailZone,
    parameters,
    natCat,
  );

  const hazardEvidence =
    natCat?.evidence ??
    (weatherFallbackUsed
      ? {
          ...openMeteoProvider.evidence(),
          confidence: 0.15,
          fallbackUsed: true,
          limitations: [
            "Live weather lookup failed; using conservative neutral defaults",
          ],
        }
      : openMeteoProvider.evidence());
  const evidence = riskEvidence(boundary, detection, hazardEvidence);
  const confidence = round(
    evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length,
  );

  return {
    overallScore: round(overallScore),
    perils,
    eal: ealBreakdown.total,
    ealBreakdown,
    exposureEur: round(exposureEur),
    utilisation: round(utilisation),
    capacityEstimate: Math.round(capacityEstimate),
    confidence,
    modelVersion: RISK_MODEL_VERSION,
    evidence,
    ...(natCat ? { natCat } : {}),
    limitations: riskLimitations(boundary, detection, natCat),
    computedAt: new Date().toISOString(),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

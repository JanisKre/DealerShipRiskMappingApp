import type {
  BoundaryResult,
  DetectionResult,
  HailZone,
  RiskAssessment,
} from "@shared/types";
import { exposureRatioForBoundary } from "./roof.service";
import { fetchWeather, openMeteoProvider } from "./weather.service";
import { capacityForArea, estimatedExposureEur } from "./risk/exposure";
import { riskEvidence, riskLimitations } from "./risk/evidence";
import { computeEalBreakdown, RISK_MODEL_VERSION } from "./risk/financial-loss";
import { scorePerils } from "./risk/hazard-models";

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
): Promise<RiskAssessment> {
  const [weather, exposureRatio] = await Promise.all([
    fetchWeather(lat, lon),
    boundary ? exposureRatioForBoundary(boundary) : Promise.resolve(1),
  ]);

  const perils = scorePerils(weather, hailZone);
  const weights = {
    wind: 0.24,
    lightning: 0.1,
    snow: 0.14,
    flood: 0.28,
    hail: 0.19,
    heat: 0.05,
  } as const;
  const overallScore = perils.reduce(
    (sum, peril) => sum + peril.score * weights[peril.peril],
    0,
  );

  const exposureEur = estimatedExposureEur(detection, assetValue);
  const exposureAreaSqm = boundary?.areaSqm ?? 0;
  const capacityEstimate = capacityForArea(exposureAreaSqm);
  const carCount = detection?.vehicleCount ?? 0;
  const utilisation = capacityEstimate > 0 ? carCount / capacityEstimate : 0;
  const ealBreakdown = computeEalBreakdown(
    weather,
    exposureEur,
    exposureRatio,
    hailZone,
  );

  const evidence = riskEvidence(boundary, detection, openMeteoProvider.evidence());
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
    limitations: riskLimitations(boundary, detection),
    computedAt: new Date().toISOString(),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

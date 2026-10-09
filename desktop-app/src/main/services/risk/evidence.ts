import type {
  BoundaryResult,
  DetectionResult,
  HailEalDetail,
  NatCatAssessment,
  RiskEvidence,
} from "@shared/types";
import { RISK_MODEL_VERSION } from "./financial-loss";

export function riskEvidence(
  boundary: BoundaryResult | undefined,
  detection: DetectionResult | undefined,
  hazardEvidence?: RiskEvidence,
  hailDetail?: HailEalDetail,
): RiskEvidence[] {
  const now = new Date().toISOString();
  const evidence: RiskEvidence[] = [
    hazardEvidence ?? {
      source: "Open-Meteo",
      retrievedAt: now,
      dataVersion: "forecast-api",
      spatialResolution: "model grid",
      method: "92-day weather window with screening proxies",
      confidence: 0.55,
      fallbackUsed: false,
      limitations: ["Not a catastrophe-model or engineering assessment"],
    },
  ];

  // The hail zone drives λ_z in the EAL, so its source is evidence in its
  // own right. A provider zone is already covered by the provider evidence.
  if (hailDetail?.zoneSource === "postcode") {
    evidence.push({
      source: "Postcode hail zones",
      retrievedAt: now,
      spatialResolution: "postcode",
      method: "postcode hail-zone lookup",
      confidence: 0.7,
      fallbackUsed: false,
      limitations: [],
    });
  } else if (hailDetail?.zoneSource === "estimated") {
    evidence.push({
      source: "Open-Meteo",
      retrievedAt: now,
      spatialResolution: "model grid",
      method: "hail zone estimated from weather-based hail score",
      confidence: 0.3,
      fallbackUsed: true,
      limitations: [HAIL_ZONE_ESTIMATED],
    });
  }

  if (boundary) {
    evidence.push(
      boundary.evidence ?? {
        source: boundary.source.toUpperCase(),
        retrievedAt: now,
        method:
          boundary.source === "synthetic"
            ? "synthetic radius fallback"
            : "geospatial boundary lookup",
        confidence: boundary.confidence,
        fallbackUsed: boundary.source === "synthetic",
        limitations:
          boundary.source === "synthetic"
            ? ["Manual boundary review recommended"]
            : [],
      },
    );
  }
  if (detection) {
    evidence.push(
      detection.evidence ?? {
        source: detection.model,
        retrievedAt: now,
        method:
          detection.model === "stub-area-heuristic"
            ? "area-based estimate"
            : "aerial object detection",
        confidence: detection.confidence,
        fallbackUsed: detection.model === "stub-area-heuristic",
        limitations:
          detection.model === "stub-area-heuristic"
            ? ["Vehicle count is estimated; install the detector model"]
            : [],
      },
    );
  }
  return evidence;
}

export const HAIL_ZONE_ESTIMATED =
  "Hail zone estimated from weather data; no postcode hail zone available";
export const HAIL_EAL_PLACEHOLDERS =
  "Hail EAL frequency and severity parameters are uncalibrated placeholders";
export const HAIL_VEHICLES_FROM_ASSET_VALUE =
  "Hail EAL vehicle count derived from the declared asset value";

export function riskLimitations(
  boundary: BoundaryResult | undefined,
  detection: DetectionResult | undefined,
  natCat?: NatCatAssessment,
  hailDetail?: HailEalDetail,
): string[] {
  const limitations = [
    `Risk model ${RISK_MODEL_VERSION} is a screening model`,
    "Hazard values are location-level proxies and should be validated before underwriting decisions",
    HAIL_EAL_PLACEHOLDERS,
  ];
  if (hailDetail?.zoneSource === "estimated")
    limitations.push(HAIL_ZONE_ESTIMATED);
  if (hailDetail?.vehicleSource === "assetValue")
    limitations.push(HAIL_VEHICLES_FROM_ASSET_VALUE);
  if (
    natCat &&
    natCat.hazards.every(
      (hazard) =>
        hazard.annualExceedanceProbability == null &&
        hazard.returnPeriodYears == null,
    )
  ) {
    limitations.push(
      `${natCat.provider} liefert Hazard-Klassen/Scores; die EAL bleibt ohne Frequenz- oder Verlustdaten ein Screening-Modell`,
    );
  }
  if (boundary?.source === "synthetic")
    limitations.push("Synthetic lot boundary used");
  if (boundary?.reviewRequired) {
    limitations.push("Boundary requires review before underwriting use");
  }
  if (boundary?.confirmedAt) {
    limitations.push(
      `Boundary confirmed by visual review on ${boundary.confirmedAt.slice(0, 10)}, not a cadastral survey`,
    );
  }
  if (
    boundary?.role &&
    boundary.role !== "operationalLot" &&
    boundary.role !== "synthetic" &&
    boundary.confirmedAt == null
  ) {
    limitations.push(
      `Boundary represents ${boundary.role}, not a confirmed operational lot`,
    );
  }
  if ((boundary?.quality?.sourceAgreement ?? 0) < 0.35) {
    limitations.push("Boundary sources do not sufficiently agree");
  }
  if (detection?.model === "stub-area-heuristic")
    limitations.push(
      "Vehicle exposure is estimated because no ML model is installed",
    );
  return limitations;
}

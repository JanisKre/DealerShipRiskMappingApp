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
  // The hazard source is listed only when it contributed: with a postcode
  // zone no weather data is fetched (see scoreRisk).
  const evidence: RiskEvidence[] = hazardEvidence ? [hazardEvidence] : [];

  // The hail zone drives λ_z in the EAL, so its source is evidence in its
  // own right. A provider zone is already covered by the provider evidence.
  if (hailDetail?.zoneSource === "postcode") {
    evidence.push({
      source: "Postcode hail zones",
      retrievedAt: now,
      dataVersion: HAIL_ZONE_TABLE_VERSION,
      spatialResolution: "postcode",
      method: "postcode hail-zone lookup",
      confidence: 0.7,
      fallbackUsed: false,
      limitations: [HAIL_ZONE_REGIONAL],
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

/** Version of the static postcode table in `shared/hail-zones.ts`. */
export const HAIL_ZONE_TABLE_VERSION =
  "postcode table, as of 2024 (8,183 postcodes)";
export const HAIL_ZONE_REGIONAL =
  "Postcode hail zone describes regional hazard, not the individual site";
export const HAIL_ZONE_ESTIMATED =
  "Hail zone estimated from weather data; no postcode hail zone available";
export const HAIL_EAL_PLACEHOLDERS =
  "Hail EAL frequency and severity parameters are uncalibrated placeholders";
export const HAIL_VEHICLES_FROM_ASSET_VALUE =
  "Hail EAL vehicle count derived from the declared asset value";

/**
 * Upper bound of the overall confidence while λ, p and S are uncalibrated
 * placeholders: a reviewed boundary or a checked vehicle count must not
 * make the hail EAL look more certain than its parameters are.
 */
export const PLACEHOLDER_CONFIDENCE_CAP = 0.6;

/** Evidence entries that belong to the hail chain (hazard and zone). */
const HAIL_CHAIN_SOURCES = new Set(["Open-Meteo", "Postcode hail zones"]);

/**
 * Overall confidence of an assessment: the mean of all evidence, but never
 * above the weakest link of the hail chain (provider, zone or weather
 * proxy) and never above `PLACEHOLDER_CONFIDENCE_CAP`. Averaging alone let
 * a confirmed boundary lift the confidence of an estimated hail zone.
 */
export function overallConfidence(
  evidence: RiskEvidence[],
  hazardSource?: string,
): number {
  if (evidence.length === 0) return 0;
  const mean =
    evidence.reduce((sum, item) => sum + item.confidence, 0) / evidence.length;
  const chain = evidence.filter(
    (item) =>
      HAIL_CHAIN_SOURCES.has(item.source) || item.source === hazardSource,
  );
  const weakest = chain.length
    ? Math.min(...chain.map((item) => item.confidence))
    : 1;
  return Math.min(mean, weakest, PLACEHOLDER_CONFIDENCE_CAP);
}

export const STOCK_SNAPSHOT_PREFIX = "Stock snapshot not typical: ";

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
  const stock = hailDetail?.stockRange;
  if (stock && stock.snapshot !== "typical") {
    limitations.push(
      `${STOCK_SNAPSHOT_PREFIX}${hailDetail.vehicles} vehicles on the analysed image against a median of ${stock.vehiclesMedian} on ${stock.images} archived images: the point EAL may ${stock.snapshot === "high" ? "overstate" : "understate"} typical stock (range ${stock.ealLow}–${stock.ealHigh} EUR)`,
    );
  }
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

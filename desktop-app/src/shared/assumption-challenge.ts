import type { AnalyzedDealership, RiskParameters } from "./types";
import { DEFAULT_RISK_PARAMETERS } from "./parameters";
import { IMAGERY_STALE_AFTER_YEARS, imageryAgeYears } from "./imagery-metadata";
import {
  dealershipHailZone,
  displayedHailVehicleSource,
  isAreaEstimatedDetection,
} from "./risk-math";

/**
 * "Advocatus Diaboli": the weakest assumptions behind a location's hail
 * result, found by fixed rules from what the app stored (vehicle source,
 * boundary provenance, image age, stock range, hail zone source, parameter
 * calibration, fallbacks). It does not change any figure; it says where the
 * figure is most likely wrong and in which direction. Works without AI; the
 * optional AI layer only words the same points as a counter-argument.
 */

export const CHALLENGE_KINDS = [
  "notAnalyzed",
  "noVehicleCount",
  "estimatedVehicles",
  "syntheticBoundary",
  "boundaryReview",
  "staleImagery",
  "stockSnapshot",
  "singleImage",
  "lowDetectionConfidence",
  "zoneEstimated",
  "fallbackData",
  "placeholderParameters",
  "noProtectionConsidered",
] as const;
export type ChallengeKind = (typeof CHALLENGE_KINDS)[number];

/** In which direction the hail EAL could be off if the assumption fails. */
export type ChallengeEffect = "unavailable" | "higher" | "lower" | "either";

export interface Challenge {
  kind: ChallengeKind;
  /** 3 = the result rests on it, 2 = can move it clearly, 1 = general caveat. */
  severity: 1 | 2 | 3;
  effect: ChallengeEffect;
  /** Interpolation values for the locale text (`challenge.kind.<kind>`). */
  values?: Record<string, string | number>;
}

/** Detector confidence below which the count itself is a weak point. */
export const CHALLENGE_LOW_DETECTION_CONFIDENCE = 0.5;

const HAIL_PARAMETER_KEYS = [
  "hailFrequencyZone1",
  "hailFrequencyZone2",
  "hailFrequencyZone3",
  "hailFrequencyZone4",
  "hailFrequencyZone5",
  "hailFrequencyZone6",
  "hailShareSmall",
  "hailShareMedium",
  "hailShareLarge",
  "hailSeveritySmallEur",
  "hailSeverityMediumEur",
  "hailSeverityLargeEur",
] as const satisfies ReadonlyArray<keyof RiskParameters>;

/** True while frequency and severity are still the shipped placeholders. */
export function usesPlaceholderHailParameters(
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): boolean {
  return HAIL_PARAMETER_KEYS.every(
    (key) => parameters[key] === DEFAULT_RISK_PARAMETERS[key],
  );
}

export function challengeAssumptions(
  d: AnalyzedDealership,
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
  now: Date = new Date(),
): Challenge[] {
  if (!d.risk) {
    return [{ kind: "notAnalyzed", severity: 3, effect: "unavailable" }];
  }
  const found: Challenge[] = [];
  const detail = d.risk.ealBreakdown?.hailDetail;
  const manual = d.detection?.manualVehicleCount != null;
  const source = displayedHailVehicleSource(detail?.vehicleSource, d.detection);

  if (!manual && source === "none") {
    found.push({ kind: "noVehicleCount", severity: 3, effect: "unavailable" });
  } else if (
    !manual &&
    (source === "estimated" || isAreaEstimatedDetection(d.detection))
  ) {
    found.push({ kind: "estimatedVehicles", severity: 3, effect: "either" });
  }

  if (d.boundary?.source === "synthetic") {
    found.push({ kind: "syntheticBoundary", severity: 3, effect: "either" });
  } else if (d.boundary?.reviewRequired && !d.boundary.confirmedAt) {
    found.push({
      kind: "boundaryReview",
      severity: 2,
      effect: "either",
      values: { confidence: Math.round(d.boundary.confidence * 100) },
    });
  }

  const capturedAt = d.detection?.imagery?.chosen.capturedAt;
  if (!manual && capturedAt) {
    const age = imageryAgeYears(capturedAt, now);
    if (age >= IMAGERY_STALE_AFTER_YEARS) {
      found.push({
        kind: "staleImagery",
        severity: 2,
        effect: "either",
        values: { year: capturedAt.slice(0, 4), age: Math.floor(age) },
      });
    }
  }

  const range = detail?.stockRange;
  if (!manual && range && range.snapshot !== "typical") {
    found.push({
      kind: "stockSnapshot",
      severity: 2,
      // A count above the archived median overstates a typical day.
      effect: range.snapshot === "high" ? "lower" : "higher",
      values: {
        low: Math.round(range.vehiclesLow),
        median: Math.round(range.vehiclesMedian),
        high: Math.round(range.vehiclesHigh),
        images: range.images,
      },
    });
  } else if (!manual && !range && source === "detected") {
    found.push({ kind: "singleImage", severity: 1, effect: "either" });
  }

  if (
    !manual &&
    source === "detected" &&
    d.detection != null &&
    d.detection.confidence < CHALLENGE_LOW_DETECTION_CONFIDENCE
  ) {
    found.push({
      kind: "lowDetectionConfidence",
      severity: 2,
      effect: "either",
      values: { confidence: Math.round(d.detection.confidence * 100) },
    });
  }

  const zone = dealershipHailZone(d);
  if (zone?.source === "estimated") {
    found.push({
      kind: "zoneEstimated",
      severity: 2,
      effect: "either",
      values: { zone: zone.zone },
    });
  }

  const fallbacks = (d.risk.evidence ?? []).filter((e) => e.fallbackUsed);
  if (fallbacks.length > 0) {
    found.push({
      kind: "fallbackData",
      severity: 2,
      effect: "either",
      values: { sources: fallbacks.map((e) => e.source).join(", ") },
    });
  }

  if (usesPlaceholderHailParameters(parameters)) {
    found.push({
      kind: "placeholderParameters",
      severity: 2,
      effect: "either",
    });
  }
  // The model counts every vehicle on the lot as exposed (docs/risk-model.md).
  if (source !== "none") {
    found.push({
      kind: "noProtectionConsidered",
      severity: 1,
      effect: "lower",
    });
  }

  // Stable: by severity, then in rule order.
  return found
    .map((challenge, index) => ({ challenge, index }))
    .sort(
      (a, b) =>
        b.challenge.severity - a.challenge.severity || a.index - b.index,
    )
    .map(({ challenge }) => challenge);
}

const FACT_TEXT: Record<ChallengeKind, string> = {
  notAnalyzed: "The location has not been analysed; there is no result.",
  noVehicleCount:
    "No vehicles were counted on the lot, so no hail EAL is available.",
  estimatedVehicles:
    "The vehicle figure is an estimate from the lot area, not a count.",
  syntheticBoundary:
    "The lot boundary is a fallback circle around the point with an assumed radius.",
  boundaryReview:
    "The lot boundary is flagged for review (confidence {confidence} %) and not confirmed.",
  staleImagery:
    "Vehicles were counted on an aerial image from {year}, about {age} years old.",
  stockSnapshot:
    "On {images} archived images the stock ranged from {low} to {high} vehicles (median {median}); the count used is not a typical day.",
  singleImage:
    "The vehicle count comes from a single aerial image, one day's stock.",
  lowDetectionConfidence:
    "The detector's confidence for the vehicle count is {confidence} %.",
  zoneEstimated:
    "Hail zone {zone} is estimated from weather data, not taken from the postcode table or a provider.",
  fallbackData: "Fallback data was used for: {sources}.",
  placeholderParameters:
    "Hail frequency and loss per vehicle are uncalibrated placeholder values.",
  noProtectionConsidered:
    "Every counted vehicle is treated as parked in the open; hail nets, canopies or halls are not considered.",
};

const EFFECT_TEXT: Record<ChallengeEffect, string> = {
  unavailable: "no usable EAL",
  higher: "the true EAL may be higher",
  lower: "the true EAL may be lower",
  either: "the EAL may be off in either direction",
};

/** Plain-text facts for the optional AI counter-argument. No amounts. */
export function challengeFacts(name: string, challenges: Challenge[]): string {
  const lines = challenges.map((c) => {
    const text = FACT_TEXT[c.kind].replace(/\{(\w+)\}/g, (_, key: string) =>
      String(c.values?.[key] ?? "?"),
    );
    return `- [weight ${c.severity} of 3] ${text} (${EFFECT_TEXT[c.effect]})`;
  });
  return [`Location: ${name}`, "Weak points, heaviest first:", ...lines].join(
    "\n",
  );
}

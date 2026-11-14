import type { AnalyzedDealership } from "./types";
import { IMAGERY_STALE_AFTER_YEARS, imageryAgeYears } from "./imagery-metadata";
import {
  dealershipHailZone,
  displayedHailVehicleSource,
  isAreaEstimatedDetection,
} from "./risk-math";

/**
 * Questions an underwriter can send to a dealership, picked by fixed rules
 * from what is missing or uncertain at the location. The texts live in the
 * locale files (`questionnaire.q.<id>`); this only decides which questions
 * apply and with which values. Works without AI; the optional AI rewording
 * keeps the selection and order.
 */

export const QUESTION_IDS = [
  "hailProtection",
  "coveredSpaces",
  "outdoorAtNight",
  "averageStock",
  "seasonalPeak",
  "hailWarning",
  "lotExtent",
  "siteChanges",
  "pastLosses",
] as const;
export type QuestionId = (typeof QUESTION_IDS)[number];

/** Hail zones from which the storm-warning and season questions apply. */
export const QUESTIONNAIRE_HIGH_ZONE = 4;

export interface Question {
  id: QuestionId;
  /** Interpolation values for the question text. */
  values?: Record<string, string | number>;
  /** Why the rule picked it, as a locale key under `questionnaire.why`. */
  why: "always" | "estimatedStock" | "highZone" | "boundary" | "oldImage";
}

export function buildQuestionnaire(
  d: AnalyzedDealership,
  now: Date = new Date(),
): Question[] {
  const questions: Question[] = [
    { id: "hailProtection", why: "always" },
    { id: "coveredSpaces", why: "always" },
    { id: "outdoorAtNight", why: "always" },
  ];
  const detail = d.risk?.ealBreakdown?.hailDetail;
  const source = displayedHailVehicleSource(detail?.vehicleSource, d.detection);
  const estimated =
    d.detection?.manualVehicleCount == null &&
    (source === "estimated" ||
      source === "none" ||
      isAreaEstimatedDetection(d.detection) ||
      detail?.stockRange?.snapshot === "high" ||
      detail?.stockRange?.snapshot === "low");
  if (estimated) questions.push({ id: "averageStock", why: "estimatedStock" });

  const zone = dealershipHailZone(d)?.zone;
  if (zone != null && zone >= QUESTIONNAIRE_HIGH_ZONE) {
    questions.push({ id: "seasonalPeak", why: "highZone", values: { zone } });
    questions.push({ id: "hailWarning", why: "highZone", values: { zone } });
  }
  if (d.boundary?.reviewRequired || d.boundary?.source === "synthetic")
    questions.push({ id: "lotExtent", why: "boundary" });

  const capturedAt = d.detection?.imagery?.chosen.capturedAt;
  if (
    capturedAt &&
    imageryAgeYears(capturedAt, now) >= IMAGERY_STALE_AFTER_YEARS
  ) {
    questions.push({
      id: "siteChanges",
      why: "oldImage",
      values: { year: capturedAt.slice(0, 4) },
    });
  }
  questions.push({ id: "pastLosses", why: "always", values: { years: 5 } });
  return questions;
}

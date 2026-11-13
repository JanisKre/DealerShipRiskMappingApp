import type { TFunction } from "i18next";
import type {
  AnalyzedDealership,
  DealershipChangeKind,
  RiskParameters,
} from "@shared/types";
import {
  IMAGERY_STALE_AFTER_YEARS,
  imageryAgeYears,
} from "@shared/imagery-metadata";
import { buildUnderwritingMessages } from "./UnderwritingMessages";

/**
 * The underwriter's review queue: locations with an open point that needs
 * a human look (boundary to check, outdated aerial image, a warning or
 * critical underwriting notice), in order of hail EAL. A location leaves
 * the queue once it is marked as reviewed and comes back when its result
 * changes afterwards (re-analysis, new boundary, new vehicle count).
 *
 * The placeholder detection model is deliberately not a reason: it is a
 * set-up issue of the whole app, not of one location, and would put every
 * location in the queue.
 */
export type ReviewReason = "boundary" | "imagery" | "underwriting";

/** Changes that invalidate an earlier review. */
const REOPENING_CHANGES: ReadonlySet<DealershipChangeKind> = new Set([
  "analyzed",
  "boundaryChanged",
  "vehicleCountChanged",
]);

/** Why this location needs a look; empty when nothing is open. */
export function reviewReasons(
  t: TFunction,
  d: AnalyzedDealership,
  dealerships: AnalyzedDealership[],
  parameters: RiskParameters,
): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  if (d.boundary?.reviewRequired) reasons.push("boundary");
  const capturedAt = d.detection?.imagery?.chosen.capturedAt;
  const age = capturedAt ? imageryAgeYears(capturedAt) : null;
  if (age != null && age >= IMAGERY_STALE_AFTER_YEARS) reasons.push("imagery");
  if (
    buildUnderwritingMessages(t, d, dealerships, parameters).some(
      (m) => m.severity === "warning" || m.severity === "danger",
    )
  ) {
    reasons.push("underwriting");
  }
  return reasons;
}

/**
 * True when the location was marked as reviewed and nothing that changes
 * its result happened since.
 */
export function isReviewCurrent(d: AnalyzedDealership): boolean {
  const history = d.history ?? [];
  for (let i = history.length - 1; i >= 0; i--) {
    const kind = history[i].kind;
    if (kind === "reviewed") return true;
    if (REOPENING_CHANGES.has(kind)) return false;
  }
  return false;
}

/** Ids of the locations with open review points, highest hail EAL first. */
export function buildReviewQueue(
  t: TFunction,
  dealerships: AnalyzedDealership[],
  parameters: RiskParameters,
): string[] {
  return dealerships
    .filter(
      (d) =>
        d.lat != null &&
        d.lon != null &&
        !isReviewCurrent(d) &&
        reviewReasons(t, d, dealerships, parameters).length > 0,
    )
    .sort((a, b) => (b.risk?.eal ?? 0) - (a.risk?.eal ?? 0))
    .map((d) => d.id);
}

/**
 * Next stop after `currentId` in a review run, skipping locations that were
 * reviewed meanwhile; null at the end of the run.
 */
export function nextInReview(
  ids: string[],
  currentId: string,
  isOpen: (id: string) => boolean,
): string | null {
  const start = ids.indexOf(currentId);
  for (let i = start + 1; i < ids.length; i++) {
    if (isOpen(ids[i])) return ids[i];
  }
  return null;
}

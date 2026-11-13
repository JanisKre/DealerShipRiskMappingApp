import type { BoundaryResult, RiskParameters } from "./types";

/**
 * Why a boundary must be checked by a human. Shown next to the review badge
 * so the reviewer knows what to look at; a flag alone carries no reason.
 */
export const BOUNDARY_REVIEW_REASONS = [
  "synthetic",
  "lowConfidence",
  "pointOutside",
  "vehiclesOutside",
  "cadastreIncomplete",
  "noLotAtPoint",
  "winterImagery",
  /** A result of the removed fusion/legacy engines failed one of their checks. */
  "legacyEngine",
] as const;
export type BoundaryReviewReason = (typeof BOUNDARY_REVIEW_REASONS)[number];

/**
 * The single definition of "this boundary must be checked by a human", with
 * its reasons.
 *
 * Main computes it once when a boundary is detected; the renderer recomputes it
 * whenever the user changes a review threshold, without a round trip. Those two
 * used to be separate copies that had already drifted (the renderer defaulted a
 * missing `top2Margin` to 1, main always computed one), so a parameter change
 * could silently clear a review flag that detection had set.
 *
 * Fusion-only signals are deliberately absent-tolerant: a boundary produced by
 * the legacy chain carries no `barrierSupport` or `stoppedBy`, and a missing
 * field must never be read as a failing one.
 */
export function boundaryReviewReasons(
  boundary: BoundaryResult,
  parameters: RiskParameters,
): BoundaryReviewReason[] {
  // A human already looked at it: either drew/edited it or confirmed it as is.
  if (boundary.source === "manual" || boundary.confirmedAt != null) return [];
  const quality = boundary.quality;
  const reasons: BoundaryReviewReason[] = [];
  if (boundary.source === "synthetic") reasons.push("synthetic");
  if (boundary.confidence < parameters.boundaryReviewConfidence) {
    reasons.push("lowConfidence");
  }
  if (quality?.pointRelation === "outside") reasons.push("pointOutside");
  if (tooManyOutside(boundary)) reasons.push("vehiclesOutside");
  for (const flag of quality?.reviewFlags ?? []) {
    if (!reasons.includes(flag)) reasons.push(flag);
  }
  // The source cascade encodes its own trust in a fixed per-stage confidence
  // (boundary/cascade.ts). Agreement, role and margin describe the ranking it
  // replaced and would flag every cadastral or single-source result.
  if (quality?.usedEngine === "cascade") return reasons;
  const legacyFails =
    boundary.role !== "operationalLot" ||
    (quality?.top2Margin ?? 1) < parameters.boundaryReviewTop2Margin ||
    (quality?.sourceAgreement ?? 0) <
      parameters.boundaryReviewSourceAgreement ||
    (quality?.areaPlausibility ?? 0) < 0.5 ||
    (quality?.barrierSupport !== undefined &&
      quality.barrierSupport < parameters.boundaryBarrierSupportReview) ||
    // Growth that hit a cap was truncated by the cap, not by real evidence.
    (quality?.stoppedBy !== undefined && quality.stoppedBy !== "exhausted");
  if (legacyFails && reasons.length === 0) reasons.push("legacyEngine");
  return reasons;
}

export function boundaryNeedsReview(
  boundary: BoundaryResult,
  parameters: RiskParameters,
): boolean {
  return boundaryReviewReasons(boundary, parameters).length > 0;
}

/**
 * A couple of cars on the kerb or at a neighbouring business is normal; a whole
 * row outside the ring is not.
 */
export const MAX_UNEXPLAINED_OUTSIDE_VEHICLES = 5;

/**
 * With a known lot size (cascade v3), vehicles just outside count as a clipped
 * lot only when they are both a real row (`MIN_OUTSIDE_ROW`) and a meaningful
 * share of the lot (`MAX_OUTSIDE_SHARE`): on a 300-car lot, six cars at the
 * kerb are noise. Before v3 every result above five was flagged, 44 of 61 in
 * the audited portfolio.
 */
export const MIN_OUTSIDE_ROW = 10;
export const MAX_OUTSIDE_SHARE = 0.15;

function tooManyOutside(boundary: BoundaryResult): boolean {
  const outside = boundary.quality?.vehiclesOutsideNearby ?? 0;
  const lot = boundary.quality?.lotVehicles;
  if (lot == null) return outside > MAX_UNEXPLAINED_OUTSIDE_VEHICLES;
  return outside >= MIN_OUTSIDE_ROW && outside >= MAX_OUTSIDE_SHARE * lot;
}

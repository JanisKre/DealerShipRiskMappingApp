import type { BoundaryResult, RiskParameters } from "./types";

/**
 * The single definition of "this boundary must be checked by a human".
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
export function boundaryNeedsReview(
  boundary: BoundaryResult,
  parameters: RiskParameters,
): boolean {
  const quality = boundary.quality;
  return (
    boundary.source === "synthetic" ||
    boundary.role !== "operationalLot" ||
    boundary.confidence < parameters.boundaryReviewConfidence ||
    (quality?.top2Margin ?? 1) < parameters.boundaryReviewTop2Margin ||
    quality?.pointRelation === "outside" ||
    (quality?.sourceAgreement ?? 0) < parameters.boundaryReviewSourceAgreement ||
    (quality?.areaPlausibility ?? 0) < 0.5 ||
    (quality?.barrierSupport !== undefined &&
      quality.barrierSupport < parameters.boundaryBarrierSupportReview) ||
    // Growth that hit a cap was truncated by the cap, not by real evidence.
    (quality?.stoppedBy !== undefined && quality.stoppedBy !== "exhausted") ||
    // Vehicles clustered just outside the ring almost always mean a clipped lot.
    (quality?.vehiclesOutsideNearby ?? 0) > MAX_UNEXPLAINED_OUTSIDE_VEHICLES
  );
}

/**
 * A couple of cars on the kerb or at a neighbouring business is normal; a whole
 * row outside the ring is not.
 */
export const MAX_UNEXPLAINED_OUTSIDE_VEHICLES = 5;

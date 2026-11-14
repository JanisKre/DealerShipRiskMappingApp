import type { AnalyzedDealership } from "./types";
import {
  displayedHailVehicleSource,
  isAreaEstimatedDetection,
} from "./risk-math";

/**
 * Why a location's vehicles, exposure and hail EAL are estimates rather than
 * counts: `vehicles` — no detection model ran, the vehicle figure is lot
 * area ÷ space per vehicle; `boundary` — the lot is the fallback circle
 * around the point, so whatever was counted inside it depends on an assumed
 * radius. A reviewed vehicle count is neither.
 */
export type EstimateReason = "vehicles" | "boundary";

export function estimateReasons(d: AnalyzedDealership): EstimateReason[] {
  if (!d.risk || d.detection?.manualVehicleCount != null) return [];
  const reasons: EstimateReason[] = [];
  const source = displayedHailVehicleSource(
    d.risk.ealBreakdown?.hailDetail?.vehicleSource,
    d.detection,
  );
  // The area figure no longer enters N, but it is still what the vehicle
  // and exposure columns show, so it keeps its marker.
  if (source === "estimated" || isAreaEstimatedDetection(d.detection))
    reasons.push("vehicles");
  if (d.boundary?.source === "synthetic") reasons.push("boundary");
  return reasons;
}

/**
 * Whether the location's hail EAL rests on a vehicle count (detected or
 * reviewed). Without one N = 0 by design (docs/risk-model.md,
 * screening-0.5.1): the EAL is then "not available", not "0 €", and must
 * not be ranked, summed as if complete or used for share rules.
 */
export function hasEalBasis(d: AnalyzedDealership): boolean {
  if (!d.risk) return false;
  return (
    displayedHailVehicleSource(
      d.risk.ealBreakdown?.hailDetail?.vehicleSource,
      d.detection,
    ) !== "none"
  );
}

/** How many analysed locations carry a hail EAL basis. */
export function ealCoverage(dealerships: readonly AnalyzedDealership[]): {
  withBasis: number;
  analyzed: number;
} {
  let withBasis = 0;
  let analyzed = 0;
  for (const d of dealerships) {
    if (!d.risk) continue;
    analyzed += 1;
    if (hasEalBasis(d)) withBasis += 1;
  }
  return { withBasis, analyzed };
}

/**
 * Below this share of analysed locations with a vehicle count, the
 * "share of portfolio EAL" review rule stays silent: one counted site among
 * fifty would otherwise "cause 100 % of the portfolio EAL".
 */
export const MIN_EAL_COVERAGE_FOR_SHARE_RULE = 0.5;

/**
 * Above this share of estimated exposure an accumulation note is a data
 * check ("Prüfen – Datenbasis geschätzt"), not a critical finding.
 */
export const ESTIMATED_EXPOSURE_REVIEW_SHARE = 0.5;

/** Exposure of the given locations and how much of it is an estimate. */
export function estimatedExposure(dealerships: readonly AnalyzedDealership[]): {
  totalEur: number;
  estimatedEur: number;
  /** 0..1; 0 when there is no exposure. */
  share: number;
} {
  let totalEur = 0;
  let estimatedEur = 0;
  for (const d of dealerships) {
    const exposure = d.risk?.exposureEur ?? 0;
    totalEur += exposure;
    if (estimateReasons(d).length > 0) estimatedEur += exposure;
  }
  return {
    totalEur,
    estimatedEur,
    share: totalEur > 0 ? estimatedEur / totalEur : 0,
  };
}

/**
 * Sort key for "highest hail EAL first": locations with a vehicle count by
 * their EAL (≥ 0), then locations without a count by exposure (in (-1, 0)),
 * then locations that are not analysed (-2). Descending order therefore
 * never ranks a "no count" site above a counted one.
 */
export function ealSortValue(d: AnalyzedDealership): number {
  if (!d.risk) return -2;
  if (hasEalBasis(d)) return d.risk.eal;
  return -1 / (1 + Math.max(0, d.risk.exposureEur ?? 0));
}

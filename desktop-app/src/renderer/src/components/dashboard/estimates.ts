import type { AnalyzedDealership } from "@shared/types";
import {
  displayedHailVehicleSource,
  isAreaEstimatedDetection,
} from "@shared/risk-math";

/**
 * Why a location's vehicles, exposure and hail EAL are estimates rather than
 * counts: `vehicles` — no detection model ran, N is lot area ÷ space per
 * vehicle; `boundary` — the lot is the fallback circle around the point, so
 * whatever was counted inside it depends on an assumed radius. A reviewed
 * vehicle count is neither.
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
  // column shows, so it keeps its marker.
  if (source === "estimated" || isAreaEstimatedDetection(d.detection))
    reasons.push("vehicles");
  if (d.boundary?.source === "synthetic") reasons.push("boundary");
  return reasons;
}

import type { AnalyzedDealership } from "@shared/types";
import { AREA_ESTIMATE_DETECTOR } from "@shared/risk-math";

/** Locations counted per batch; each is several full detector runs. */
export const STOCK_COUNT_BATCH = 20;

/**
 * The locations a batch stock count covers: those with a machine count and
 * no count over time yet, highest hail EAL first, so the few counted are
 * the ones that move the portfolio EAL most.
 */
export function stockCountCandidates(
  dealerships: AnalyzedDealership[],
  limit = STOCK_COUNT_BATCH,
): string[] {
  return dealerships
    .filter(
      (d) =>
        d.risk != null &&
        d.detection != null &&
        d.detection.model !== AREA_ESTIMATE_DETECTOR &&
        d.detection.timeline == null,
    )
    .sort((a, b) => (b.risk?.eal ?? 0) - (a.risk?.eal ?? 0))
    .slice(0, limit)
    .map((d) => d.id);
}

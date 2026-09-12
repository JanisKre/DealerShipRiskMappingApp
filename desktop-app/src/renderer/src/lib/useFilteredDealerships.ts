import { useMemo } from "react";
import type { AnalyzedDealership } from "@shared/types";
import { computeAccumulationClusters } from "@shared/risk-math";
import { ACCUMULATION_RADIUS_KM } from "@shared/constants";
import { useAppStore } from "@renderer/store/appStore";
import { applyMetaFilters } from "@renderer/components/dashboard/PortfolioFilterBar";

/**
 * Applies the active portfolio filters (sub-portfolio/partner/group + cluster)
 * to a dealership list. The cluster filter is resolved via the deterministic
 * accumulation-cluster computation (member IDs).
 */
export function useFilteredDealerships(
  dealerships: AnalyzedDealership[],
): AnalyzedDealership[] {
  const filters = useAppStore((s) => s.filters);

  return useMemo(() => {
    let out = applyMetaFilters(dealerships, filters);
    if (filters.clusterId) {
      const withCoords = dealerships.filter(
        (d) => d.lat != null && d.lon != null,
      );
      const cluster = computeAccumulationClusters(
        withCoords,
        ACCUMULATION_RADIUS_KM,
      ).find((c) => c.clusterId === filters.clusterId);
      const ids = new Set(cluster?.memberIds ?? []);
      out = out.filter((d) => ids.has(d.id));
    }
    return out;
  }, [dealerships, filters]);
}

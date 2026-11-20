import { useMemo } from "react";
import type { AnalyzedDealership } from "@shared/types";
import { useAppStore } from "@renderer/store/appStore";
import {
  applyMetaFilters,
  resolveFilterCluster,
} from "@renderer/components/dashboard/PortfolioFilterBar";

/**
 * Applies the active portfolio filters (sub-portfolio/partner/group + cluster)
 * to a dealership list. The cluster filter is resolved via the deterministic
 * accumulation-cluster computation (member IDs).
 */
export function useFilteredDealerships(
  dealerships: AnalyzedDealership[],
): AnalyzedDealership[] {
  const filters = useAppStore((s) => s.filters);
  const parameters = useAppStore((s) => s.parameters);

  return useMemo(() => {
    let out = applyMetaFilters(dealerships, filters);
    if (filters.clusterId) {
      const cluster = resolveFilterCluster(dealerships, filters, parameters);
      const ids = new Set(cluster?.memberIds ?? []);
      out = out.filter((d) => ids.has(d.id));
    }
    return out;
  }, [dealerships, filters, parameters]);
}

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Circle, Tooltip } from "react-leaflet";
import type { AnalyzedDealership } from "@shared/types";
import { computeAccumulationClusters } from "@shared/risk-math";
import { ACCUMULATION_RADIUS_KM } from "@shared/constants";
import { riskColor } from "@renderer/lib/riskColor";
import { eur } from "@renderer/lib/format";
import { useAppStore } from "@renderer/store/appStore";

/** Opacity range for a cluster's EAL share (weak -> strong). */
const MIN_FILL_OPACITY = 0.06;
const MAX_FILL_OPACITY = 0.4;
const ACTIVE_FILL_BOOST = 0.15;

/**
 * Draws the accumulation clusters (>= 2 locations) as colored radius circles
 * around their center — color by maximum hail score, opacity by EAL share
 * of the portfolio (replaces the earlier separate accumulation heatmap: same
 * message "how much risk sits here", but on the real, radius-based clusters
 * instead of an arbitrary grid). Clicking a circle toggles the cluster
 * filter; the active cluster is emphasized.
 */
export function AccumulationClusterLayer({
  dealerships,
}: Readonly<{
  dealerships: AnalyzedDealership[];
}>): React.JSX.Element | null {
  const { t } = useTranslation();
  const activeClusterId = useAppStore((s) => s.filters.clusterId);
  const setFilters = useAppStore((s) => s.setFilters);

  const clusters = useMemo(
    () =>
      computeAccumulationClusters(dealerships, ACCUMULATION_RADIUS_KM).filter(
        (c) => c.count > 1,
      ),
    [dealerships],
  );

  const maxEal = useMemo(
    () => Math.max(1, ...clusters.map((c) => c.totalEalEur)),
    [clusters],
  );

  if (clusters.length === 0) return null;

  return (
    <>
      {clusters.map((c) => {
        const active = c.clusterId === activeClusterId;
        const color = riskColor(c.maxHailScore);
        const ealShare = c.totalEalEur / maxEal;
        const fillOpacity =
          MIN_FILL_OPACITY +
          (MAX_FILL_OPACITY - MIN_FILL_OPACITY) * ealShare +
          (active ? ACTIVE_FILL_BOOST : 0);
        return (
          <Circle
            key={c.clusterId}
            center={[c.centerLat, c.centerLon]}
            radius={ACCUMULATION_RADIUS_KM * 1000}
            pathOptions={{
              color,
              weight: active ? 3 : 1.5,
              fillColor: color,
              fillOpacity,
            }}
            eventHandlers={{
              click: () =>
                setFilters({ clusterId: active ? null : c.clusterId }),
            }}
          >
            <Tooltip>
              <div className="space-y-0.5">
                <strong className="font-mono">{c.clusterId}</strong>
                <div>
                  {c.count} {t("dashboard.locations")} · {t("ui.hailLevel")}{" "}
                  {c.maxHailScore.toFixed(0)}
                </div>
                <div>
                  {t("ui.value")}: {eur(c.totalExposureEur)}
                </div>
                <div>
                  {t("dashboard.totalEal")}: {eur(c.totalEalEur)}
                </div>
                <div>
                  {t("ui.natCatKpi")}: {eur(c.natCatKpiEur)}
                </div>
              </div>
            </Tooltip>
          </Circle>
        );
      })}
    </>
  );
}

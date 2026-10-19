import type { AnalyzedDealership, DashboardSpec } from "./types";
import { computeSeasonalProfile, type SeasonalPoint } from "./analytics";
import { dealershipHailZone, effectiveVehicleCount } from "./risk-math";

/**
 * Deterministic aggregate computation for AI dashboards. Pure function
 * without I/O. The `DashboardRenderer` reads exclusively from this catalog —
 * the LLM only arranges widgets and picks sources (`source`), it never
 * invents numbers.
 */

/** A generic series point for bar/pie/line charts. */
export interface SeriesPoint {
  label: string;
  value: number;
}

export interface DashboardData {
  kpi: {
    count: number;
    totalEal: number;
    totalExposure: number;
    totalVehicles: number;
    /** Locations in hail zone 4 or higher. */
    elevatedZoneCount: number;
  };
  hailZoneDistribution: SeriesPoint[];
  topEal: SeriesPoint[];
  topHailZone: SeriesPoint[];
  seasonalProfile: SeasonalPoint[];
}

const HAIL_ZONES = [1, 2, 3, 4, 5, 6] as const;
const ELEVATED_HAIL_ZONE = 4;

/** Computes the full, fixed aggregate catalog of a portfolio. */
export function computeDashboardData(
  dealerships: AnalyzedDealership[],
): DashboardData {
  const count = dealerships.length;
  const totalEal = dealerships.reduce((a, d) => a + (d.risk?.eal ?? 0), 0);
  const totalExposure = dealerships.reduce(
    (a, d) => a + (d.risk?.exposureEur ?? 0),
    0,
  );
  const totalVehicles = dealerships.reduce(
    (a, d) => a + effectiveVehicleCount(d.detection),
    0,
  );
  const zoneOf = (d: AnalyzedDealership): number | undefined =>
    dealershipHailZone(d)?.zone;
  const elevatedZoneCount = dealerships.filter(
    (d) => (zoneOf(d) ?? 0) >= ELEVATED_HAIL_ZONE,
  ).length;

  // Hail zone distribution: zones in ascending order, empty ones dropped.
  const hailZoneDistribution: SeriesPoint[] = HAIL_ZONES.map((zone) => ({
    label: `Zone ${zone}`,
    value: dealerships.filter((d) => zoneOf(d) === zone).length,
  })).filter((e) => e.value > 0);

  // Top-N by EAL or hail zone (default 10; `limit` only applies in the renderer).
  const topEal: SeriesPoint[] = [...dealerships]
    .filter((d) => (d.risk?.eal ?? 0) > 0)
    .sort((a, b) => (b.risk?.eal ?? 0) - (a.risk?.eal ?? 0))
    .slice(0, 10)
    .map((d) => ({ label: d.name, value: Math.round(d.risk?.eal ?? 0) }));

  // Ties on the zone are broken by EAL.
  const topHailZone: SeriesPoint[] = dealerships
    .filter((d) => zoneOf(d) != null)
    .sort(
      (a, b) =>
        (zoneOf(b) ?? 0) - (zoneOf(a) ?? 0) ||
        (b.risk?.eal ?? 0) - (a.risk?.eal ?? 0),
    )
    .slice(0, 10)
    .map((d) => ({ label: d.name, value: zoneOf(d) ?? 0 }));

  const seasonalProfile = computeSeasonalProfile(dealerships);

  return {
    kpi: {
      count,
      totalEal,
      totalExposure,
      totalVehicles,
      elevatedZoneCount,
    },
    hailZoneDistribution,
    topEal,
    topHailZone,
    seasonalProfile,
  };
}

/**
 * Deterministic fallback dashboard layout for when the LLM is unavailable or
 * does not return a valid spec. Covers the most important metrics.
 */
export function buildDefaultDashboardSpec(): DashboardSpec {
  return {
    title: "Portfolio overview",
    widgets: [
      { id: "kpi-count", type: "kpi", title: "Locations", source: "kpi.count" },
      {
        id: "kpi-eal",
        type: "kpi",
        title: "Total EAL",
        source: "kpi.totalEal",
      },
      {
        id: "kpi-exposure",
        type: "kpi",
        title: "Total exposure",
        source: "kpi.totalExposure",
      },
      {
        id: "kpi-vehicles",
        type: "kpi",
        title: "Total vehicles",
        source: "kpi.totalVehicles",
      },
      {
        id: "kpi-extreme",
        type: "kpi",
        title: "Locations in hail zone 4+",
        source: "kpi.elevatedZoneCount",
      },
      {
        id: "dist",
        type: "pieChart",
        title: "Hail zone distribution",
        source: "hailZoneDistribution",
      },
      {
        id: "top-score",
        type: "barChart",
        title: "Locations by hail zone",
        source: "topHailZone",
        limit: 10,
      },
      { id: "seasonal", type: "seasonal", title: "Hail seasonal profile" },
      { id: "table", type: "table", title: "All locations" },
    ],
  };
}

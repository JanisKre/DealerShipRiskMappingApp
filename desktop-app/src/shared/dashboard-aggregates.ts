import type { AnalyzedDealership, DashboardSpec, Peril } from "./types";
import {
  computeCoverage,
  computeSeasonalProfile,
  type SeasonalPoint,
} from "./analytics";
import { effectiveVehicleCount } from "./risk-math";

/**
 * Deterministic aggregate computation for AI dashboards. Pure function
 * without I/O. The `DashboardRenderer` reads exclusively from this catalog —
 * the LLM only arranges widgets and picks sources (`source`), it never
 * invents numbers.
 *
 * The label/bucket logic is deliberately duplicated here (instead of being
 * imported from the renderer's `riskColor`/`perilLabel`) so this module in
 * `shared/` stays free of renderer dependencies.
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
    avgScore: number;
    totalVehicles: number;
    extremeCount: number;
  };
  riskDistribution: SeriesPoint[];
  topEal: SeriesPoint[];
  topScore: SeriesPoint[];
  perilCoverage: SeriesPoint[];
  seasonalProfile: SeasonalPoint[];
}

/** Peril labels (mirrors `renderer/lib/perilLabel`, shared-safe). */
const PERIL_LABEL: Record<Peril, string> = {
  wind: "Storm",
  lightning: "Lightning",
  snow: "Snow",
  flood: "Flood",
  hail: "Hail",
  heat: "Heat",
};

/** Discrete risk tiers with label and threshold (descending). */
const RISK_BUCKETS: Array<{ label: string; min: number }> = [
  { label: "Extreme", min: 75 },
  { label: "High", min: 50 },
  { label: "Medium", min: 25 },
  { label: "Low", min: 0 },
];

function riskBucketLabel(score: number): string {
  return RISK_BUCKETS.find((b) => score >= b.min)?.label ?? "Low";
}

/** Computes the full, fixed aggregate catalog of a portfolio. */
export function computeDashboardData(
  dealerships: AnalyzedDealership[],
): DashboardData {
  const scored = dealerships.filter((d) => d.risk);

  const count = dealerships.length;
  const totalEal = dealerships.reduce((a, d) => a + (d.risk?.eal ?? 0), 0);
  const totalExposure = dealerships.reduce(
    (a, d) => a + (d.risk?.exposureEur ?? 0),
    0,
  );
  const avgScore =
    scored.length > 0
      ? scored.reduce((a, d) => a + (d.risk?.overallScore ?? 0), 0) /
        scored.length
      : 0;
  const totalVehicles = dealerships.reduce(
    (a, d) => a + effectiveVehicleCount(d.detection),
    0,
  );
  const extremeCount = dealerships.filter(
    (d) => (d.risk?.overallScore ?? 0) >= 75,
  ).length;

  // Risk distribution: buckets in fixed order, empty ones dropped.
  const bucketCounts = new Map<string, number>();
  for (const label of RISK_BUCKETS.map((b) => b.label))
    bucketCounts.set(label, 0);
  for (const d of dealerships) {
    const label = riskBucketLabel(d.risk?.overallScore ?? 0);
    bucketCounts.set(label, (bucketCounts.get(label) ?? 0) + 1);
  }
  const riskDistribution: SeriesPoint[] = RISK_BUCKETS.map((b) => ({
    label: b.label,
    value: bucketCounts.get(b.label) ?? 0,
  })).filter((e) => e.value > 0);

  // Top-N by EAL or score (default 10; `limit` only applies in the renderer).
  const topEal: SeriesPoint[] = [...dealerships]
    .filter((d) => (d.risk?.eal ?? 0) > 0)
    .sort((a, b) => (b.risk?.eal ?? 0) - (a.risk?.eal ?? 0))
    .slice(0, 10)
    .map((d) => ({ label: d.name, value: Math.round(d.risk?.eal ?? 0) }));

  const topScore: SeriesPoint[] = [...dealerships]
    .sort((a, b) => (b.risk?.overallScore ?? 0) - (a.risk?.overallScore ?? 0))
    .slice(0, 10)
    .map((d) => ({
      label: d.name,
      value: Math.round(d.risk?.overallScore ?? 0),
    }));

  // Peril coverage: average score per hazard (from the existing coverage analysis).
  const coverage = computeCoverage(dealerships);
  const perilCoverage: SeriesPoint[] = coverage.perils.map((p) => ({
    label: PERIL_LABEL[p.peril],
    value: Math.round(p.avgScore),
  }));

  const seasonalProfile = computeSeasonalProfile(dealerships);

  return {
    kpi: {
      count,
      totalEal,
      totalExposure,
      avgScore,
      totalVehicles,
      extremeCount,
    },
    riskDistribution,
    topEal,
    topScore,
    perilCoverage,
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
        id: "kpi-score",
        type: "kpi",
        title: "Avg. risk score",
        source: "kpi.avgScore",
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
        title: "Extreme risks",
        source: "kpi.extremeCount",
      },
      {
        id: "dist",
        type: "pieChart",
        title: "Risk distribution",
        source: "riskDistribution",
      },
      {
        id: "top-score",
        type: "barChart",
        title: "Top risk locations",
        source: "topScore",
        limit: 10,
      },
      { id: "coverage", type: "coverage", title: "Hazard coverage" },
      { id: "seasonal", type: "seasonal", title: "Seasonal profile" },
      { id: "table", type: "table", title: "All locations" },
    ],
  };
}

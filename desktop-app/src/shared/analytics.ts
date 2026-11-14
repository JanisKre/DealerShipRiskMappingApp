import type { AnalyzedDealership, Peril, RiskParameters } from "./types";
import { PERILS } from "./types";
import { DEFAULT_RISK_PARAMETERS } from "./parameters";
import {
  computeAccumulationClusters,
  computeClusterRisk,
  dealershipHailZone,
  effectiveVehicleCount,
} from "./risk-math";
import {
  ESTIMATED_EXPOSURE_REVIEW_SHARE,
  MIN_EAL_COVERAGE_FOR_SHARE_RULE,
  ealCoverage,
  estimatedExposure,
  hasEalBasis,
} from "./estimates";

/**
 * Portfolio analytics: pure functions without I/O (called from the renderer).
 * Ports the idea from `anomalyDetector`/`alertEngine`/`coverageAnalysis` of the
 * web app to this app's hail score model. Only fields from
 * `AnalyzedDealership` that are available on the renderer side are used.
 */

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

// --- Rule-based review notes ("Prüfhinweise") -------------------------------

/**
 * Each kind is one named, documented rule; the dashboard shows the rule text
 * next to every hit so underwriters can see why a location was flagged.
 */
export type AlertKind =
  | "high-hail-zone"
  | "high-eal"
  | "accumulation"
  | "overcapacity"
  | "low-boundary-confidence"
  | "no-detection"
  | "estimated-hail-zone";

export interface Alert {
  dealershipId: string;
  name: string;
  level: "critical" | "warning";
  kind: AlertKind;
  message: string;
  /** Structured values let renderers localize the message themselves. */
  value?: number;
  source?: string;
  /** Accumulation alerts: every location in the accumulation. */
  memberIds?: string[];
  /**
   * Accumulation alerts: share (0..1) of the exposure that is an estimate
   * (area-based vehicle figure or fallback circle). Above
   * `ESTIMATED_EXPOSURE_REVIEW_SHARE` the note is a data check, not critical.
   */
  estimatedShare?: number;
  /** `estimated`: the figure behind the note is mostly an estimate. */
  dataBasis?: "estimated";
}

/**
 * Rules, in order of severity:
 * - high-hail-zone: hail zone >= alertHailZone
 * - high-eal: location causes >= alertEalPortfolioShare of the portfolio EAL;
 *   only locations with a vehicle count, and only once at least
 *   MIN_EAL_COVERAGE_FOR_SHARE_RULE of the analysed locations have one
 * - accumulation: accumulation (accumulationRadiusKm) with exposure >=
 *   accumulationReinsureThresholdEur — one alert per accumulation; a
 *   warning with `dataBasis: "estimated"` when more than
 *   ESTIMATED_EXPOSURE_REVIEW_SHARE of its exposure is estimated
 * - data quality: utilisation > alertOvercapacity, boundary confidence <=
 *   alertLowBoundaryConfidence, zero vehicles, hail zone only estimated
 */
export function generateAlerts(
  dealerships: AnalyzedDealership[],
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): Alert[] {
  const totalEal = dealerships.reduce(
    (a, d) => a + (hasEalBasis(d) ? (d.risk?.eal ?? 0) : 0),
    0,
  );
  const coverage = ealCoverage(dealerships);
  const shareRuleActive =
    coverage.analyzed > 0 &&
    coverage.withBasis / coverage.analyzed >= MIN_EAL_COVERAGE_FOR_SHARE_RULE;
  const out: Alert[] = [];

  for (const d of dealerships) {
    const r = d.risk;
    if (!r) continue;
    const hailZone = dealershipHailZone(d);

    if (hailZone && hailZone.zone >= parameters.alertHailZone) {
      out.push({
        dealershipId: d.id,
        name: d.name,
        level: "critical",
        kind: "high-hail-zone",
        message: `Hail zone ${hailZone.zone} (threshold ${parameters.alertHailZone}).`,
        value: hailZone.zone,
      });
    }

    if (
      shareRuleActive &&
      totalEal > 0 &&
      hasEalBasis(d) &&
      r.eal / totalEal >= parameters.alertEalPortfolioShare
    ) {
      out.push({
        dealershipId: d.id,
        name: d.name,
        level: "critical",
        kind: "high-eal",
        message: `Contributes ${((r.eal / totalEal) * 100).toFixed(0)}% of the portfolio EAL.`,
        value: (r.eal / totalEal) * 100,
      });
    }

    if (r.utilisation != null && r.utilisation > parameters.alertOvercapacity) {
      out.push({
        dealershipId: d.id,
        name: d.name,
        level: "warning",
        kind: "overcapacity",
        message: `Overcapacity (${(r.utilisation * 100).toFixed(0)}% of capacity).`,
        value: r.utilisation * 100,
      });
    }

    if (
      d.boundary &&
      d.boundary.confidence <= parameters.alertLowBoundaryConfidence
    ) {
      out.push({
        dealershipId: d.id,
        name: d.name,
        level: "warning",
        kind: "low-boundary-confidence",
        message: `Uncertain lot boundary (source ${d.boundary.source}).`,
        source: d.boundary.source,
      });
    }

    if (d.detection && effectiveVehicleCount(d.detection) === 0) {
      out.push({
        dealershipId: d.id,
        name: d.name,
        level: "warning",
        kind: "no-detection",
        message: "No vehicles detected — check boundary/aerial imagery.",
      });
    }

    if (hailZone?.source === "estimated") {
      out.push({
        dealershipId: d.id,
        name: d.name,
        level: "warning",
        kind: "estimated-hail-zone",
        message: `Hail zone ${hailZone.zone} estimated from weather data.`,
        value: hailZone.zone,
      });
    }
  }

  const byId = new Map(dealerships.map((d) => [d.id, d]));
  const located = dealerships.filter((d) => d.lat != null && d.lon != null);
  for (const cluster of computeAccumulationClusters(
    located,
    parameters.accumulationRadiusKm,
    parameters,
  )) {
    if (
      cluster.count < 2 ||
      cluster.totalExposureEur < parameters.accumulationReinsureThresholdEur
    )
      continue;
    // Anchor the alert on the member with the largest exposure.
    const anchor = cluster.memberIds
      .map((id) => byId.get(id))
      .filter((d): d is AnalyzedDealership => d != null)
      .sort(
        (a, b) => (b.risk?.exposureEur ?? 0) - (a.risk?.exposureEur ?? 0),
      )[0];
    if (!anchor) continue;
    const members = cluster.memberIds
      .map((id) => byId.get(id))
      .filter((d): d is AnalyzedDealership => d != null);
    const estimatedShare = estimatedExposure(members).share;
    const mostlyEstimated = estimatedShare > ESTIMATED_EXPOSURE_REVIEW_SHARE;
    out.push({
      dealershipId: anchor.id,
      name: anchor.name,
      level: mostlyEstimated ? "warning" : "critical",
      kind: "accumulation",
      message: `Accumulation of ${cluster.count} locations with ${cluster.totalExposureEur} EUR exposure (${Math.round(estimatedShare * 100)}% estimated).`,
      value: cluster.totalExposureEur,
      memberIds: cluster.memberIds,
      estimatedShare,
      ...(mostlyEstimated ? { dataBasis: "estimated" as const } : {}),
    });
  }

  // Critical first; the sort is stable, so rule order is kept within a level.
  return out.sort((a, b) =>
    a.level === b.level ? 0 : a.level === "critical" ? -1 : 1,
  );
}

/** IDs of all locations with at least one alert — for table badges. */
export function alertIdSet(alerts: Alert[]): Set<string> {
  return new Set(alerts.flatMap((a) => a.memberIds ?? [a.dealershipId]));
}

// --- Coverage/concentration analysis ---------------------------------------

export interface PerilCoverage {
  peril: Peril;
  avgScore: number;
  /** Share of locations with score >= 50. */
  highShare: number;
}

export interface CoverageReport {
  perils: PerilCoverage[];
  concentration: {
    /** Herfindahl-Hirschman index of the EAL distribution (0..1; 1 = everything at one location). */
    herfindahl: number;
    /** Effective number of locations = 1/HHI (diversification measure). */
    effectiveLocations: number;
    /** EAL share of the strongest cluster cell (0.5deg grid). */
    topCellShare: number;
    topCellId: string | null;
  };
}

function perilScoreOf(d: AnalyzedDealership, peril: Peril): number | undefined {
  return d.risk?.perils.find((p) => p.peril === peril)?.score;
}

export function computeCoverage(
  dealerships: AnalyzedDealership[],
): CoverageReport {
  const scored = dealerships.filter((d) => d.risk);

  const perils: PerilCoverage[] = PERILS.map((peril) => {
    const scores = scored
      .map((d) => perilScoreOf(d, peril))
      .filter((s): s is number => s != null);
    const high = scores.filter((s) => s >= 50).length;
    return {
      peril,
      avgScore: mean(scores),
      highShare: scores.length ? high / scores.length : 0,
    };
  });

  // Concentration over EAL: HHI + strongest grid cell.
  const totalEal = scored.reduce((a, d) => a + (d.risk?.eal ?? 0), 0);
  let herfindahl = 0;
  if (totalEal > 0) {
    for (const d of scored) {
      const share = (d.risk?.eal ?? 0) / totalEal;
      herfindahl += share * share;
    }
  }

  const cells = computeClusterRisk(scored);
  const totalCellEal = cells.reduce((a, c) => a + c.totalEalEur, 0);
  const topCell = cells.reduce<(typeof cells)[number] | null>(
    (best, c) => (best == null || c.totalEalEur > best.totalEalEur ? c : best),
    null,
  );

  return {
    perils,
    concentration: {
      herfindahl,
      effectiveLocations: herfindahl > 0 ? 1 / herfindahl : 0,
      topCellShare:
        totalCellEal > 0 && topCell ? topCell.totalEalEur / totalCellEal : 0,
      topCellId: topCell?.cellId ?? null,
    },
  };
}

// --- Seasonal profile (typical distribution of hail risk over the year) --

/**
 * Climatological monthly hail weights (sum ~= 12, so the yearly average
 * matches the score). Deliberately labelled a "typical" seasonal profile —
 * it is not a location-specific measurement series, but the known
 * seasonality of convective hail in Central Europe (peak May–August).
 */
const HAIL_SEASON_WEIGHTS = [
  //J  F    M    A    M    J    J    A    S    O    N    D
  0.1, 0.2, 0.4, 0.9, 1.6, 2.1, 2.2, 1.9, 1.1, 0.5, 0.2, 0.1,
];

export const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

export interface SeasonalPoint {
  month: string;
  hail: number;
}

/**
 * Produces a 12-month profile of the portfolio hail risk: the portfolio
 * average hail score, modulated with the climatological monthly weights.
 */
export function computeSeasonalProfile(
  dealerships: AnalyzedDealership[],
): SeasonalPoint[] {
  const avg = mean(
    dealerships
      .map((d) => perilScoreOf(d, "hail"))
      .filter((s): s is number => s != null),
  );
  return MONTH_LABELS.map((month, i) => ({
    month,
    hail: Math.round(avg * HAIL_SEASON_WEIGHTS[i]),
  }));
}

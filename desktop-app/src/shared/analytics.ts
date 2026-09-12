import type { AnalyzedDealership, Peril } from "./types";
import { PERILS } from "./types";
import { computeClusterRisk, effectiveVehicleCount } from "./risk-math";

/**
 * Portfolio analytics: pure functions without I/O (called from the renderer).
 * Ports the idea from `anomalyDetector`/`alertEngine`/`coverageAnalysis` of the
 * web app to this app's 5+1-peril score model. Only fields from
 * `AnalyzedDealership` that are available on the renderer side are used.
 */

// --- Anomaly detection (statistical outliers) ------------------------------

export interface Anomaly {
  dealershipId: string;
  name: string;
  metric: "score" | "eal" | "utilisation";
  value: number;
  /** Standardized distance from the portfolio mean (signed). */
  zScore: number;
  severity: "high" | "medium";
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}

function stddev(xs: number[], mu: number): number {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((a, b) => a + (b - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

const METRIC_LABEL: Record<Anomaly["metric"], string> = {
  score: "Risk score",
  eal: "EAL",
  utilisation: "Utilisation",
};

export function anomalyMetricLabel(m: Anomaly["metric"]): string {
  return METRIC_LABEL[m];
}

/**
 * Finds locations whose metric (score/EAL/utilisation) deviates more than 2σ
 * from the portfolio mean (|z| >= 3 => "high"). Requires at least 3 locations
 * with the given metric, otherwise the statistic is not meaningful.
 */
export function detectAnomalies(dealerships: AnalyzedDealership[]): Anomaly[] {
  const metrics: Array<{
    metric: Anomaly["metric"];
    value: (d: AnalyzedDealership) => number | undefined;
  }> = [
    { metric: "score", value: (d) => d.risk?.overallScore },
    { metric: "eal", value: (d) => d.risk?.eal },
    { metric: "utilisation", value: (d) => d.risk?.utilisation },
  ];

  const out: Anomaly[] = [];
  for (const { metric, value } of metrics) {
    const present = dealerships
      .map((d) => ({ d, v: value(d) }))
      .filter((x): x is { d: AnalyzedDealership; v: number } => x.v != null);
    if (present.length < 3) continue;

    const mu = mean(present.map((x) => x.v));
    const sigma = stddev(
      present.map((x) => x.v),
      mu,
    );
    if (sigma === 0) continue;

    for (const { d, v } of present) {
      const z = (v - mu) / sigma;
      if (Math.abs(z) < 2) continue;
      out.push({
        dealershipId: d.id,
        name: d.name,
        metric,
        value: v,
        zScore: z,
        severity: Math.abs(z) >= 3 ? "high" : "medium",
      });
    }
  }
  // Strongest outliers first.
  return out.sort((a, b) => Math.abs(b.zScore) - Math.abs(a.zScore));
}

// --- Rule-based alerts ------------------------------------------------------

export type AlertKind =
  | "extreme-risk"
  | "overcapacity"
  | "low-boundary-confidence"
  | "no-detection"
  | "high-eal";

export interface Alert {
  dealershipId: string;
  name: string;
  level: "critical" | "warning";
  kind: AlertKind;
  message: string;
}

/** Thresholds for the alert rules (deliberately centralized, easy to tune). */
export interface AlertThresholds {
  extremeScore: number;
  overcapacity: number;
  lowBoundaryConfidence: number;
  ealPortfolioShare: number;
}

export const ALERT_THRESHOLDS: AlertThresholds = {
  extremeScore: 75,
  overcapacity: 1.0,
  lowBoundaryConfidence: 0.3,
  /** Relative EAL alert: location contributes >= 20% of the portfolio EAL. */
  ealPortfolioShare: 0.2,
} as const;

export function generateAlerts(
  dealerships: AnalyzedDealership[],
  thresholds: AlertThresholds = ALERT_THRESHOLDS,
): Alert[] {
  const totalEal = dealerships.reduce((a, d) => a + (d.risk?.eal ?? 0), 0);
  const out: Alert[] = [];

  for (const d of dealerships) {
    const r = d.risk;
    if (!r) continue;

    if (r.overallScore >= thresholds.extremeScore) {
      out.push({
        dealershipId: d.id,
        name: d.name,
        level: "critical",
        kind: "extreme-risk",
        message: `Extreme risk (score ${r.overallScore.toFixed(0)}/100).`,
      });
    }

    if (
      totalEal > 0 &&
      r.eal / totalEal >= thresholds.ealPortfolioShare
    ) {
      out.push({
        dealershipId: d.id,
        name: d.name,
        level: "critical",
        kind: "high-eal",
        message: `Contributes ${((r.eal / totalEal) * 100).toFixed(0)}% of the portfolio EAL.`,
      });
    }

    if (
      r.utilisation != null &&
      r.utilisation > thresholds.overcapacity
    ) {
      out.push({
        dealershipId: d.id,
        name: d.name,
        level: "warning",
        kind: "overcapacity",
        message: `Overcapacity (${(r.utilisation * 100).toFixed(0)}% of capacity).`,
      });
    }

    if (
      d.boundary &&
      d.boundary.confidence <= thresholds.lowBoundaryConfidence
    ) {
      out.push({
        dealershipId: d.id,
        name: d.name,
        level: "warning",
        kind: "low-boundary-confidence",
        message: `Uncertain lot boundary (source ${d.boundary.source}).`,
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
  }

  // Critical first.
  return out.sort((a, b) =>
    a.level === b.level ? 0 : a.level === "critical" ? -1 : 1,
  );
}

/** IDs of all locations with at least one alert — for table badges. */
export function alertIdSet(alerts: Alert[]): Set<string> {
  return new Set(alerts.map((a) => a.dealershipId));
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

// --- Seasonal profile (typical distribution of peril risk over the year) --

/**
 * Climatological monthly weights per peril (sum per peril ~= 12, so the
 * yearly average matches the score). Deliberately labelled a "typical"
 * seasonal profile — it is not a location-specific measurement series, but
 * the known seasonality of hazards in Central Europe (thunderstorms/hail in
 * summer, wind storms in the winter half-year, snow in deep winter, heat in
 * midsummer, flood with two peaks).
 */
const SEASON_WEIGHTS: Record<Peril, number[]> = {
  //          J    F    M    A    M    J    J    A    S    O    N    D
  wind: [1.8, 1.7, 1.5, 1.0, 0.7, 0.5, 0.5, 0.6, 0.8, 1.1, 1.6, 1.8],
  lightning: [0.1, 0.2, 0.4, 0.8, 1.4, 2.0, 2.3, 2.1, 1.2, 0.6, 0.2, 0.1],
  hail: [0.1, 0.2, 0.4, 0.9, 1.6, 2.1, 2.2, 1.9, 1.1, 0.5, 0.2, 0.1],
  snow: [2.6, 2.3, 1.3, 0.4, 0.05, 0.0, 0.0, 0.0, 0.05, 0.3, 1.2, 2.4],
  flood: [1.2, 1.1, 1.3, 1.0, 1.0, 1.2, 1.1, 1.0, 0.8, 0.8, 1.0, 1.2],
  heat: [0.0, 0.0, 0.1, 0.4, 1.0, 1.9, 2.6, 2.5, 1.2, 0.3, 0.0, 0.0],
};

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
  wind: number;
  lightning: number;
  snow: number;
  flood: number;
  hail: number;
  heat: number;
  /** Weighted overall risk of the month (average over the perils). */
  total: number;
}

/**
 * Produces a 12-month profile of the portfolio risk: the portfolio average
 * score per peril, modulated with the climatological monthly weights. Used
 * for the weather timeline and seasonal risk profile charts.
 */
export function computeSeasonalProfile(
  dealerships: AnalyzedDealership[],
): SeasonalPoint[] {
  const scored = dealerships.filter((d) => d.risk);
  const avg: Record<Peril, number> = {} as Record<Peril, number>;
  for (const peril of PERILS) {
    avg[peril] = mean(
      scored
        .map((d) => perilScoreOf(d, peril))
        .filter((s): s is number => s != null),
    );
  }

  return MONTH_LABELS.map((month, i) => {
    const point = { month } as SeasonalPoint;
    let sum = 0;
    for (const peril of PERILS) {
      const v = avg[peril] * SEASON_WEIGHTS[peril][i];
      point[peril] = Math.round(v);
      sum += v;
    }
    point.total = Math.round(sum / PERILS.length);
    return point;
  });
}

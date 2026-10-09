import type { AnalyzedDealership, Peril, RiskParameters } from "./types";
import { PERILS } from "./types";
import { DEFAULT_RISK_PARAMETERS } from "./parameters";
import {
  computeAccumulationClusters,
  computeClusterRisk,
  dealershipHailZone,
  effectiveVehicleCount,
} from "./risk-math";

/**
 * Portfolio analytics: pure functions without I/O (called from the renderer).
 * Ports the idea from `anomalyDetector`/`alertEngine`/`coverageAnalysis` of the
 * web app to this app's 5+1-peril score model. Only fields from
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
}

/**
 * Rules, in order of severity:
 * - high-hail-zone: hail zone >= alertHailZone
 * - high-eal: location causes >= alertEalPortfolioShare of the portfolio EAL
 * - accumulation: accumulation (accumulationRadiusKm) with exposure >=
 *   accumulationReinsureThresholdEur — one alert per accumulation
 * - data quality: utilisation > alertOvercapacity, boundary confidence <=
 *   alertLowBoundaryConfidence, zero vehicles, hail zone only estimated
 */
export function generateAlerts(
  dealerships: AnalyzedDealership[],
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): Alert[] {
  const totalEal = dealerships.reduce((a, d) => a + (d.risk?.eal ?? 0), 0);
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

    if (totalEal > 0 && r.eal / totalEal >= parameters.alertEalPortfolioShare) {
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
    out.push({
      dealershipId: anchor.id,
      name: anchor.name,
      level: "critical",
      kind: "accumulation",
      message: `Accumulation of ${cluster.count} locations with ${cluster.totalExposureEur} EUR exposure.`,
      value: cluster.totalExposureEur,
      memberIds: cluster.memberIds,
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

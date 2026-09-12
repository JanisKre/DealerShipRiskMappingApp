import type {
  AccumulationCluster,
  AnalyzedDealership,
  ClusterRiskEntry,
  HailstormScenario,
  HailZone,
  HailRiskTier,
  PmlResult,
  ScenarioImpact,
} from "./types";
import {
  ACCUMULATION_REINSURE_THRESHOLD_EUR,
  PML_CLUSTER_RADIUS_KM,
  PML_DAMAGE_FRACTION,
  SCENARIO_INTENSITY_DAMAGE,
} from "./constants";

/**
 * Portfolio aggregate math (PML, cluster heatmap, scenario impact).
 * Pure functions without I/O — computed from the portfolio in the renderer,
 * ported exactly from the original (riskScoring/clusterRisk/scenarioSimulation),
 * but mapped onto this app's 5-peril score model:
 *   - Exposure comes from risk.exposureEur (vehicle value on-site)
 *   - EAL comes from risk.eal
 *   - Risk level is tracked via risk.overallScore (0..100) instead of RiskLevel
 */

export function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function exposureOf(d: AnalyzedDealership): number {
  return d.risk?.exposureEur ?? 0;
}

function hailScoreOf(d: AnalyzedDealership): number {
  return d.risk?.perils.find((p) => p.peril === "hail")?.score ?? 0;
}

/** Stable, short hash (djb2) of a string — for deterministic IDs. */
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/**
 * Probable Maximum Loss for a return period.
 * Finds the cluster with the highest total exposure within
 * PML_CLUSTER_RADIUS_KM and applies the return-period damage fraction.
 */
export function computePML(
  dealerships: AnalyzedDealership[],
  returnPeriod: 10 | 50 | 100,
): PmlResult {
  const withExposure = dealerships.filter((d) => exposureOf(d) > 0);

  let bestClusterExposure = 0;
  let bestClusterCount = 0;

  for (const anchor of withExposure) {
    const inCluster = withExposure.filter(
      (d) =>
        haversineKm(anchor.lat, anchor.lon, d.lat, d.lon) <=
        PML_CLUSTER_RADIUS_KM,
    );
    const clusterExposure = inCluster.reduce(
      (sum, d) => sum + exposureOf(d),
      0,
    );
    if (clusterExposure > bestClusterExposure) {
      bestClusterExposure = clusterExposure;
      bestClusterCount = inCluster.length;
    }
  }

  return {
    returnPeriod,
    estimatedLossEur: Math.round(
      bestClusterExposure * PML_DAMAGE_FRACTION[returnPeriod],
    ),
    dealershipsInScenario: bestClusterCount,
    clusterRadiusKm: PML_CLUSTER_RADIUS_KM,
  };
}

/** Groups dealerships into lat/lon grid cells and aggregates EAL + max score. */
export function computeClusterRisk(
  dealerships: AnalyzedDealership[],
  gridSizeDeg = 0.5,
): ClusterRiskEntry[] {
  const cells = new Map<
    string,
    {
      totalEalEur: number;
      count: number;
      maxScore: number;
      lats: number[];
      lons: number[];
    }
  >();

  for (const d of dealerships) {
    const gridLat = Math.floor(d.lat / gridSizeDeg) * gridSizeDeg;
    const gridLon = Math.floor(d.lon / gridSizeDeg) * gridSizeDeg;
    const key = `${gridLat.toFixed(4)}_${gridLon.toFixed(4)}`;

    const eal = d.risk?.eal ?? 0;
    const score = d.risk?.overallScore ?? 0;

    const existing = cells.get(key);
    if (existing) {
      existing.totalEalEur += eal;
      existing.count += 1;
      existing.maxScore = Math.max(existing.maxScore, score);
      existing.lats.push(d.lat);
      existing.lons.push(d.lon);
    } else {
      cells.set(key, {
        totalEalEur: eal,
        count: 1,
        maxScore: score,
        lats: [d.lat],
        lons: [d.lon],
      });
    }
  }

  return Array.from(cells.entries()).map(([cellId, cell]) => ({
    cellId,
    centerLat: cell.lats.reduce((a, b) => a + b, 0) / cell.lats.length,
    centerLon: cell.lons.reduce((a, b) => a + b, 0) / cell.lons.length,
    totalEalEur: Math.round(cell.totalEalEur),
    dealershipCount: cell.count,
    maxScore: cell.maxScore,
  }));
}

// --- Hailstorm scenario ------------------------------------------------------

/** Perpendicular distance from point P to segment AB, in km. */
function pointToSegmentDistKm(
  pLat: number,
  pLon: number,
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const abLat = bLat - aLat;
  const abLon = bLon - aLon;
  const apLat = pLat - aLat;
  const apLon = pLon - aLon;
  const ab2 = abLat ** 2 + abLon ** 2;
  if (ab2 === 0) return haversineKm(pLat, pLon, aLat, aLon);
  const t = Math.max(0, Math.min(1, (apLat * abLat + apLon * abLon) / ab2));
  return haversineKm(pLat, pLon, aLat + t * abLat, aLon + t * abLon);
}

function isInCorridor(
  lat: number,
  lon: number,
  path: [number, number][],
  halfWidthKm: number,
): boolean {
  for (let i = 0; i < path.length - 1; i++) {
    const [aLon, aLat] = path[i];
    const [bLon, bLat] = path[i + 1];
    if (pointToSegmentDistKm(lat, lon, aLat, aLon, bLat, bLon) <= halfWidthKm)
      return true;
  }
  return false;
}

export function computeScenarioImpact(
  scenario: HailstormScenario,
  dealerships: AnalyzedDealership[],
): ScenarioImpact {
  const halfWidth = scenario.widthKm / 2;
  const affected = dealerships.filter((d) =>
    isInCorridor(d.lat, d.lon, scenario.pathCoordinates, halfWidth),
  );

  const totalExposureEur = affected.reduce((sum, d) => sum + exposureOf(d), 0);
  const damageFraction =
    SCENARIO_INTENSITY_DAMAGE[scenario.intensityLevel] ?? 0.15;

  return {
    affectedDealershipIds: affected.map((d) => d.id),
    totalExposureEur,
    estimatedLossEur: Math.round(totalExposureEur * damageFraction),
    scenario,
  };
}

// --- Accumulation of a single location (underwriting) -----------------------

/** An insured neighbor with distance to the subject. */
export interface NearbyInsured {
  dealership: AnalyzedDealership;
  distanceKm: number;
}

/**
 * Already-insured locations within `radiusKm` of the subject (the subject
 * itself excluded), sorted ascending by distance.
 */
export function nearbyInsured(
  subject: AnalyzedDealership,
  all: AnalyzedDealership[],
  radiusKm: number,
): NearbyInsured[] {
  return all
    .filter((d) => d.id !== subject.id && d.insured === true)
    .map((d) => ({
      dealership: d,
      distanceKm: haversineKm(subject.lat, subject.lon, d.lat, d.lon),
    }))
    .filter((n) => n.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);
}

export interface AccumulationVerdict {
  radiusKm: number;
  neighborCount: number;
  /** Accumulated exposure (subject + insured neighbors) within the radius, EUR. */
  accumulatedExposureEur: number;
  /** Reinsurance recommended (accumulation above threshold)? */
  reinsure: boolean;
  /** Pricing signal from the accumulation density: more accumulation -> higher price. */
  pricingHint: "low" | "normal" | "high";
}

/**
 * Assesses the accumulation risk of a subject based on the insured neighbors
 * within the radius. Reinsurance is recommended once the accumulated exposure
 * exceeds the threshold; the pricing hint scales with the accumulation
 * density (0..50% of the threshold -> low, 50..100% -> normal, > 100% -> high).
 */
export function accumulationVerdict(
  subject: AnalyzedDealership,
  neighbors: NearbyInsured[],
  radiusKm: number,
  reinsureThresholdEur: number = ACCUMULATION_REINSURE_THRESHOLD_EUR,
): AccumulationVerdict {
  const accumulatedExposureEur =
    exposureOf(subject) +
    neighbors.reduce((sum, n) => sum + exposureOf(n.dealership), 0);

  const ratio = accumulatedExposureEur / reinsureThresholdEur;
  const pricingHint = ratio > 1 ? "high" : ratio >= 0.5 ? "normal" : "low";

  return {
    radiusKm,
    neighborCount: neighbors.length,
    accumulatedExposureEur: Math.round(accumulatedExposureEur),
    reinsure: accumulatedExposureEur >= reinsureThresholdEur,
    pricingHint,
  };
}

export interface ProductLimitBreach {
  severity: "none" | "warning" | "breach";
  limitEur: number | null;
  exposureEur: number;
  /** Modeled loss for a mid-size nat-cat event (EUR). */
  midEventLossEur: number;
}

/**
 * Checks the product limit (sum insured/coverage cap) against the exposure
 * (sum of insured vehicle values). `breach` when the exposure reaches or
 * exceeds the limit (the location cannot be fully covered); `warning` from
 * 70% of the limit (approaching the cap). The modeled loss of a mid-size
 * nat-cat event is provided as context.
 */
export function productLimitBreach(
  subject: AnalyzedDealership,
): ProductLimitBreach {
  const limitEur = subject.productLimitEur ?? null;
  const exposureEur = exposureOf(subject);
  const midEventLossEur = Math.round(
    exposureEur * SCENARIO_INTENSITY_DAMAGE.MEDIUM,
  );

  if (limitEur == null || limitEur <= 0) {
    return { severity: "none", limitEur, exposureEur, midEventLossEur };
  }

  let severity: ProductLimitBreach["severity"] = "none";
  if (exposureEur >= limitEur) {
    severity = "breach";
  } else if (exposureEur >= 0.7 * limitEur) {
    severity = "warning";
  }

  return { severity, limitEur, exposureEur, midEventLossEur };
}

// --- Group dealerships (corporate/chain network) -----------------------------

export interface GroupSummary {
  group: string;
  memberCount: number;
  insuredCount: number;
  /** Accumulated exposure of all group locations, EUR. */
  totalExposureEur: number;
  totalVehicles: number;
  totalEalEur: number;
  maxHailScore: number;
  meanHailScore: number;
  /** Number of locations that reach/exceed their product limit. */
  productLimitBreaches: number;
  /** Reinsurance recommended for the group (total exposure above threshold)? */
  reinsure: boolean;
  /** Pricing signal from the group's total exposure. */
  pricingHint: "low" | "normal" | "high";
}

/**
 * Aggregates all locations of the same group into one overall view —
 * independent of spatial distance, since a group is a single customer
 * relationship (unlike radius-based accumulation). Reinsurance is
 * recommended once the group's total exposure exceeds the threshold; the
 * pricing hint scales analogously to `accumulationVerdict`. Returns `null`
 * if the subject is not assigned to any group.
 */
export function groupSummary(
  subject: AnalyzedDealership,
  all: AnalyzedDealership[],
  reinsureThresholdEur: number = ACCUMULATION_REINSURE_THRESHOLD_EUR,
): GroupSummary | null {
  if (!subject.group) return null;
  const members = all.filter((d) => d.group === subject.group);
  const count = members.length;
  if (count === 0) return null;

  const totalExposureEur = members.reduce((s, m) => s + exposureOf(m), 0);
  const hailScores = members.map(hailScoreOf);
  const ratio = totalExposureEur / reinsureThresholdEur;

  return {
    group: subject.group,
    memberCount: count,
    insuredCount: members.filter((m) => m.insured === true).length,
    totalExposureEur: Math.round(totalExposureEur),
    totalVehicles: members.reduce(
      (s, m) => s + (m.detection?.vehicleCount ?? 0),
      0,
    ),
    totalEalEur: Math.round(members.reduce((s, m) => s + (m.risk?.eal ?? 0), 0)),
    maxHailScore: Math.max(0, ...hailScores),
    meanHailScore: Math.round(hailScores.reduce((s, x) => s + x, 0) / count),
    productLimitBreaches: members.filter(
      (m) => productLimitBreach(m).severity === "breach",
    ).length,
    reinsure: totalExposureEur >= reinsureThresholdEur,
    pricingHint: ratio > 1 ? "high" : ratio >= 0.5 ? "normal" : "low",
  };
}

// --- Accumulation clusters (portfolio-wide) ----------------------------------

/**
 * Deterministic neighborhood clusters: locations connected via a chain of
 * pairs within `radiusKm` form a cluster (union-find / single-linkage).
 * Aggregates size/value/hail and a nat-cat KPI (modeled cluster loss =
 * exposure x MEDIUM damage fraction). The stable clusterId is derived
 * deterministically from the sorted member IDs. Result sorted descending by
 * nat-cat KPI (largest first).
 */
export function computeAccumulationClusters(
  dealerships: AnalyzedDealership[],
  radiusKm: number,
): AccumulationCluster[] {
  const n = dealerships.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a: number, b: number): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const dist = haversineKm(
        dealerships[i].lat,
        dealerships[i].lon,
        dealerships[j].lat,
        dealerships[j].lon,
      );
      if (dist <= radiusKm) union(i, j);
    }
  }

  const groups = new Map<number, AnalyzedDealership[]>();
  for (let i = 0; i < n; i++) {
    const root = find(i);
    const arr = groups.get(root) ?? [];
    arr.push(dealerships[i]);
    groups.set(root, arr);
  }

  const clusters: AccumulationCluster[] = [];
  for (const members of groups.values()) {
    const count = members.length;
    const memberIds = members.map((m) => m.id).sort();
    const totalVehicles = members.reduce(
      (s, m) => s + (m.detection?.vehicleCount ?? 0),
      0,
    );
    const totalExposureEur = members.reduce((s, m) => s + exposureOf(m), 0);
    const totalEalEur = members.reduce((s, m) => s + (m.risk?.eal ?? 0), 0);
    const hailScores = members.map(hailScoreOf);
    const maxHailScore = Math.max(0, ...hailScores);
    const meanHailScore =
      hailScores.reduce((s, x) => s + x, 0) / (count || 1);
    const natCatKpiEur = Math.round(
      totalExposureEur * SCENARIO_INTENSITY_DAMAGE.MEDIUM,
    );

    // Dominant sales partner (most frequent) in the cluster.
    const partnerCounts = new Map<string, number>();
    for (const m of members) {
      if (m.salesPartner)
        partnerCounts.set(
          m.salesPartner,
          (partnerCounts.get(m.salesPartner) ?? 0) + 1,
        );
    }
    let dominantSalesPartner: string | undefined;
    let best = 0;
    for (const [partner, c] of partnerCounts) {
      if (c > best) {
        best = c;
        dominantSalesPartner = partner;
      }
    }

    clusters.push({
      clusterId: memberIds.length ? `AC-${shortHash(memberIds.join("|"))}` : "empty",
      memberIds,
      count,
      centerLat: members.reduce((s, m) => s + m.lat, 0) / count,
      centerLon: members.reduce((s, m) => s + m.lon, 0) / count,
      totalVehicles,
      totalExposureEur: Math.round(totalExposureEur),
      totalEalEur: Math.round(totalEalEur),
      maxHailScore,
      meanHailScore: Math.round(meanHailScore),
      natCatKpiEur,
      dominantSalesPartner,
    });
  }

  return clusters.sort((a, b) => b.natCatKpiEur - a.natCatKpiEur);
}

// --- Hail zone scoring --------------------------------------------------------

/**
 * Linear normalization: zone 1 -> 0.00, zone 6 -> 1.00.
 * Formula: zone_score = (zone - 1) / 5
 */
export function hailZoneToScore(zone: HailZone): number {
  return (zone - 1) / 5;
}

/** 0-100 score for the peril scoring model. */
export function hailZoneToScore100(zone: HailZone): number {
  return hailZoneToScore(zone) * 100;
}

/**
 * Risk tier from hail zone:
 * zone 1 -> Very Low, 2 -> Low, 3 -> Moderate, 4 -> High, 5-6 -> Very High.
 */
export function hailZoneToRiskTier(zone: HailZone): HailRiskTier {
  if (zone === 1) return "Very Low";
  if (zone === 2) return "Low";
  if (zone === 3) return "Moderate";
  if (zone === 4) return "High";
  return "Very High";
}

// --- Spatial co-occurrence (directional corridors) ---------------------------

/**
 * Projection radii for the three corridor tiers (WSW->ENE, bearing 70deg).
 * along = maximum extent along the track, cross = maximum cross-track width.
 */
const CORRIDOR_THRESHOLDS: Record<
  "tight" | "standard" | "stress",
  { alongKm: number; crossKm: number }
> = {
  tight:    { alongKm: 80,  crossKm: 15  },
  standard: { alongKm: 160, crossKm: 30  },
  stress:   { alongKm: 300, crossKm: 60  },
};

/** Storm track bearing in degrees (WSW->ENE). */
const STORM_BEARING_DEG = 70;

/**
 * Decomposes the offset between two points into along-track and cross-track
 * components along the WSW->ENE storm track (70deg) and checks whether point
 * B lies within the corridor around point A.
 *
 * Coordinate projection onto a local Cartesian frame (haversine approximation):
 *   dx = dlon * cos(lat_mean) * R  [km, positive eastward]
 *   dy = dlat * R                   [km, positive northward]
 * Rotation by storm bearing theta:
 *   along =  dx * sin(theta) + dy * cos(theta)   [km, positive in track direction]
 *   cross = -dx * cos(theta) + dy * sin(theta)   [km, positive to the left of the track]
 */
export function isHailCoExposed(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number },
  tier: "tight" | "standard" | "stress" = "standard",
): boolean {
  const R = 6371;
  const DEG = Math.PI / 180;
  const latMid = ((a.lat + b.lat) / 2) * DEG;
  const theta = STORM_BEARING_DEG * DEG;

  const dx = (b.lon - a.lon) * Math.cos(latMid) * R * DEG;
  const dy = (b.lat - a.lat) * R * DEG;

  const along = dx * Math.sin(theta) + dy * Math.cos(theta);
  const cross = Math.abs(-dx * Math.cos(theta) + dy * Math.sin(theta));

  const { alongKm, crossKm } = CORRIDOR_THRESHOLDS[tier];
  return Math.abs(along) <= alongKm && cross <= crossKm;
}

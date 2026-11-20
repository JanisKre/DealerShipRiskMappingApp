import type { AnalyzedDealership, HailZone, RiskParameters } from "./types";
import { DEFAULT_RISK_PARAMETERS } from "./parameters";
import { computeAccumulationClusters, dealershipHailZone } from "./risk-math";

/**
 * Capacity per accumulation and per hail zone, and what one location adds
 * to its accumulation. Pure functions on the portfolio; the capacities are
 * organisational limits the underwriter sets, not a result of the risk
 * model. Methodology: docs/risk-model.md, "Capacity".
 *
 * - Capacity per accumulation is `accumulationReinsureThresholdEur`: the
 *   exposure from which the review notes recommend reinsurance.
 * - Capacity per hail zone is `capacityZone<z>Eur`; 0 means none is set.
 */

/** Below half: free. Half to full: partly used. Full or above: exhausted. */
export type CapacityStatus = "free" | "partial" | "exhausted";

/** Same cut points as the pricing hint of the accumulation verdict. */
export function capacityStatus(utilisation: number): CapacityStatus {
  return utilisation >= 1
    ? "exhausted"
    : utilisation >= 0.5
      ? "partial"
      : "free";
}

export interface CapacityUse {
  capacityEur: number;
  /** Exposure counted against the capacity: existing and new business. */
  usedEur: number;
  /** Of `usedEur`: existing business (`insured: true`). */
  boundEur: number;
  /** Of `usedEur`: new business and rows without a business type. */
  prospectEur: number;
  /** usedEur / capacityEur; above 1 when the capacity is exceeded. */
  utilisation: number;
  /** capacityEur − usedEur; negative when the capacity is exceeded. */
  remainingEur: number;
  status: CapacityStatus;
}

function exposureOf(d: AnalyzedDealership): number {
  return Math.max(0, d.risk?.exposureEur ?? 0);
}

/**
 * How much of a capacity the given locations use. Null when no capacity is
 * set (0 or less), so callers show nothing instead of a division by zero.
 */
export function capacityUse(
  members: readonly AnalyzedDealership[],
  capacityEur: number,
): CapacityUse | null {
  if (!(capacityEur > 0)) return null;
  let boundEur = 0;
  let prospectEur = 0;
  for (const d of members) {
    if (d.insured === true) boundEur += exposureOf(d);
    else prospectEur += exposureOf(d);
  }
  boundEur = Math.round(boundEur);
  prospectEur = Math.round(prospectEur);
  const usedEur = boundEur + prospectEur;
  const utilisation = usedEur / capacityEur;
  return {
    capacityEur,
    usedEur,
    boundEur,
    prospectEur,
    utilisation,
    remainingEur: Math.round(capacityEur - usedEur),
    status: capacityStatus(utilisation),
  };
}

const ZONES: readonly HailZone[] = [1, 2, 3, 4, 5, 6];

/** Capacity set for a hail zone; 0 when none is set. */
export function zoneCapacityEur(
  parameters: RiskParameters,
  zone: HailZone,
): number {
  const value = {
    1: parameters.capacityZone1Eur,
    2: parameters.capacityZone2Eur,
    3: parameters.capacityZone3Eur,
    4: parameters.capacityZone4Eur,
    5: parameters.capacityZone5Eur,
    6: parameters.capacityZone6Eur,
  }[zone];
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export interface ZoneCapacityRow {
  zone: HailZone;
  /** Locations in the zone. */
  count: number;
  /** Exposure in the zone, whether or not a capacity is set. */
  exposureEur: number;
  /** Null when no capacity is set for the zone. */
  use: CapacityUse | null;
}

/** Exposure and capacity use per hail zone 1–6 (all six rows, in order). */
export function zoneCapacities(
  dealerships: readonly AnalyzedDealership[],
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): ZoneCapacityRow[] {
  const byZone = new Map<HailZone, AnalyzedDealership[]>(
    ZONES.map((zone) => [zone, []]),
  );
  for (const d of dealerships) {
    const zone = dealershipHailZone(d)?.zone;
    if (zone) byZone.get(zone)?.push(d);
  }
  return ZONES.map((zone) => {
    const members = byZone.get(zone) ?? [];
    return {
      zone,
      count: members.length,
      exposureEur: Math.round(members.reduce((s, d) => s + exposureOf(d), 0)),
      use: capacityUse(members, zoneCapacityEur(parameters, zone)),
    };
  });
}

export interface MarginalAccumulation {
  capacityEur: number;
  /** Locations in the accumulation, the subject included. */
  count: number;
  subjectEur: number;
  /** Exposure of the accumulation with the subject. */
  withEur: number;
  /**
   * Exposure of the largest accumulation that remains among the other
   * members when the subject is taken out. Below `withEur − subjectEur`
   * when the subject is the link between two groups.
   */
  withoutEur: number;
  /** withEur − withoutEur: what the subject adds to the largest accumulation. */
  addedEur: number;
  /** Accumulations the subject links into one; 2 or more means it bridges. */
  joins: number;
  utilisationWith: number;
  utilisationWithout: number;
  /** Capacity left before the subject; 0 when already exhausted. */
  remainingWithoutEur: number;
  /** addedEur / remainingWithoutEur; null when nothing was left. */
  shareOfRemaining: number | null;
  status: CapacityStatus;
}

/**
 * What one location adds to its accumulation (the chain of neighbours
 * within `accumulationRadiusKm`, as on the dashboard), measured against the
 * capacity per accumulation. Null without coordinates or without a capacity.
 */
export function marginalAccumulation(
  subject: AnalyzedDealership,
  all: readonly AnalyzedDealership[],
  parameters: RiskParameters = DEFAULT_RISK_PARAMETERS,
): MarginalAccumulation | null {
  const capacityEur = parameters.accumulationReinsureThresholdEur;
  if (!(capacityEur > 0)) return null;
  if (!Number.isFinite(subject.lat) || !Number.isFinite(subject.lon))
    return null;
  const located = [
    subject,
    ...all.filter(
      (d) =>
        d.id !== subject.id && Number.isFinite(d.lat) && Number.isFinite(d.lon),
    ),
  ];
  const radiusKm = parameters.accumulationRadiusKm;
  const cluster = computeAccumulationClusters(
    located,
    radiusKm,
    parameters,
  ).find((c) => c.memberIds.includes(subject.id));
  if (!cluster) return null;

  const memberIds = new Set(cluster.memberIds);
  const others = located.filter(
    (d) => d.id !== subject.id && memberIds.has(d.id),
  );
  const pieces = computeAccumulationClusters(others, radiusKm, parameters);
  const withoutEur = pieces.reduce(
    (max, piece) => Math.max(max, piece.totalExposureEur),
    0,
  );
  const withEur = cluster.totalExposureEur;
  const addedEur = Math.max(0, withEur - withoutEur);
  const remainingWithoutEur = Math.max(0, capacityEur - withoutEur);
  return {
    capacityEur,
    count: cluster.count,
    subjectEur: Math.round(exposureOf(subject)),
    withEur,
    withoutEur,
    addedEur,
    joins: pieces.length,
    utilisationWith: withEur / capacityEur,
    utilisationWithout: withoutEur / capacityEur,
    remainingWithoutEur,
    shareOfRemaining:
      remainingWithoutEur > 0 ? addedEur / remainingWithoutEur : null,
    status: capacityStatus(withEur / capacityEur),
  };
}

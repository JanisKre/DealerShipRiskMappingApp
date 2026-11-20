import {
  ACCUMULATION_RADIUS_KM,
  ACCUMULATION_REINSURE_THRESHOLD_EUR,
  CAPACITY_SQM_PER_VEHICLE,
  DETECTION_CONFIDENCE,
  HAIL_FREQUENCY_BY_ZONE,
  HAIL_SEVERITY_CLASSES,
  PML_CLUSTER_RADIUS_KM,
  PML_DAMAGE_FRACTION,
  SCENARIO_INTENSITY_DAMAGE,
  VEHICLE_VALUE_CAR_EUR,
  VEHICLE_VALUE_DEFAULT_EUR,
} from "./constants";
import { RiskParametersSchema, type RiskParameters } from "./types";

/** Defaults used for new portfolios and for old sessions without parameters. */
export const DEFAULT_RISK_PARAMETERS: RiskParameters = {
  vehicleValueCarEur: VEHICLE_VALUE_CAR_EUR,
  vehicleValueDefaultEur: VEHICLE_VALUE_DEFAULT_EUR,
  capacitySqmPerVehicle: CAPACITY_SQM_PER_VEHICLE,
  hailFrequencyZone1: HAIL_FREQUENCY_BY_ZONE[1],
  hailFrequencyZone2: HAIL_FREQUENCY_BY_ZONE[2],
  hailFrequencyZone3: HAIL_FREQUENCY_BY_ZONE[3],
  hailFrequencyZone4: HAIL_FREQUENCY_BY_ZONE[4],
  hailFrequencyZone5: HAIL_FREQUENCY_BY_ZONE[5],
  hailFrequencyZone6: HAIL_FREQUENCY_BY_ZONE[6],
  hailShareSmall: HAIL_SEVERITY_CLASSES.small.share,
  hailShareMedium: HAIL_SEVERITY_CLASSES.medium.share,
  hailShareLarge: HAIL_SEVERITY_CLASSES.large.share,
  hailSeveritySmallEur: HAIL_SEVERITY_CLASSES.small.lossEur,
  hailSeverityMediumEur: HAIL_SEVERITY_CLASSES.medium.lossEur,
  hailSeverityLargeEur: HAIL_SEVERITY_CLASSES.large.lossEur,
  pmlDamageFraction10: PML_DAMAGE_FRACTION[10],
  pmlDamageFraction50: PML_DAMAGE_FRACTION[50],
  pmlDamageFraction100: PML_DAMAGE_FRACTION[100],
  pmlClusterRadiusKm: PML_CLUSTER_RADIUS_KM,
  accumulationRadiusKm: ACCUMULATION_RADIUS_KM,
  accumulationReinsureThresholdEur: ACCUMULATION_REINSURE_THRESHOLD_EUR,
  capacityZone1Eur: 0,
  capacityZone2Eur: 0,
  capacityZone3Eur: 0,
  capacityZone4Eur: 0,
  capacityZone5Eur: 0,
  capacityZone6Eur: 0,
  scenarioDamageLow: SCENARIO_INTENSITY_DAMAGE.LOW,
  scenarioDamageMedium: SCENARIO_INTENSITY_DAMAGE.MEDIUM,
  scenarioDamageHigh: SCENARIO_INTENSITY_DAMAGE.HIGH,
  scenarioDamageExtreme: SCENARIO_INTENSITY_DAMAGE.EXTREME,
  alertHailZone: 5,
  alertOvercapacity: 1,
  alertLowBoundaryConfidence: 0.3,
  alertEalPortfolioShare: 0.2,
  boundaryReviewConfidence: 0.7,
  boundaryReviewTop2Margin: 0.1,
  boundaryReviewSourceAgreement: 0.35,
  boundaryNearPointDistanceM: 35,
  // Covers the whole lot on 66 of 76 public fixtures (87 %); see synthetic.ts.
  syntheticBoundaryRadiusM: 160,
  detectionConfidence: DETECTION_CONFIDENCE,
  boundaryGridResolutionM: 0.5,
  boundaryGridExtentM: 400,
  boundaryGrowHighThreshold: 0.6,
  // 0.4 keeps a lone landuse (0.35) or roof (0.3) from carrying growth
  // across a business park; see docs/boundary-model.md.
  boundaryGrowLowThreshold: 0.4,
  boundaryMaxAreaSqm: 60_000,
  boundaryParcelSnapOverlap: 0.6,
  boundaryVehicleEvidenceWeight: 1,
  boundaryBarrierSupportReview: 0.35,
  boundaryRegularizeAngleToleranceDeg: 12,
};

/**
 * Earlier defaults that were retuned. A stored value equal to the old default
 * was never chosen by the user — it is the old default persisted with the
 * session — so it moves to the new one. A deliberately edited value is kept.
 */
const RETIRED_DEFAULTS: Partial<RiskParameters> = {
  boundaryGrowLowThreshold: 0.15,
  boundaryMaxAreaSqm: 200_000,
  syntheticBoundaryRadiusM: 100,
};

/**
 * Revision of the parameter defaults a session was saved under. A session
 * without it predates the retuned defaults and is migrated once on load;
 * one that carries the current revision keeps every value as stored (a
 * circle radius of 100 m typed today is a choice, not the old default).
 */
export const PARAMETERS_REVISION = 1;

/** Parameters of a stored session, migrated when it predates the retune. */
export function sessionParameters(session: {
  parameters?: Partial<RiskParameters> | null;
  parametersRevision?: number;
}): RiskParameters {
  return normalizeRiskParameters(session.parameters, {
    keepRetiredDefaults:
      (session.parametersRevision ?? 0) >= PARAMETERS_REVISION,
  });
}

/**
 * Normalizes a partial/legacy session value without mutating the input.
 * `keepRetiredDefaults` is for values the user sets now: they are never an
 * old default to move.
 */
export function normalizeRiskParameters(
  value?: Partial<RiskParameters> | null,
  options: { keepRetiredDefaults?: boolean } = {},
): RiskParameters {
  const migrated: Partial<RiskParameters> = { ...value };
  if (!options.keepRetiredDefaults) {
    for (const [key, retired] of Object.entries(RETIRED_DEFAULTS) as Array<
      [keyof RiskParameters, unknown]
    >) {
      if (migrated[key] === retired) delete migrated[key];
    }
  }
  return RiskParametersSchema.parse({
    ...DEFAULT_RISK_PARAMETERS,
    ...migrated,
  });
}

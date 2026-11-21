import type { RiskParameters } from "@shared/types";
import { eur } from "@renderer/lib/format";
import { formatParameterValue, toPercentDisplay } from "./parameterInput";

/** The parameter page's fields and groups, and how a value is shown. */

export type ParameterKey = keyof RiskParameters;
type UnitKey =
  | "eur"
  | "squareMeters"
  | "fraction"
  | "factor"
  | "kilometers"
  | "eventsPerYear"
  | "eurPerVehicle"
  | "hailZone"
  | "meters";
export type ParameterField = {
  key: ParameterKey;
  unit: UnitKey;
  min: number;
  max?: number;
  step: number;
  /** Only whole numbers are valid (e.g. a hail zone). */
  integer?: boolean;
  recommended?: boolean;
  tip?: boolean;
};
type ParameterGroup = {
  id: "exposure" | "risk" | "portfolio" | "quality" | "advanced";
  fields: ParameterField[];
  defaultOpen?: boolean;
};

export const GROUPS: ParameterGroup[] = [
  {
    id: "exposure",
    defaultOpen: true,
    fields: [
      {
        key: "vehicleValueCarEur",
        unit: "eur",
        min: 0,
        max: 1_000_000,
        step: 1000,
        recommended: true,
        tip: true,
      },
      {
        key: "vehicleValueDefaultEur",
        unit: "eur",
        min: 0,
        max: 1_000_000,
        step: 1000,
      },
      {
        key: "capacitySqmPerVehicle",
        unit: "squareMeters",
        min: 0.1,
        max: 1000,
        step: 1,
        recommended: true,
        tip: true,
      },
    ],
  },
  {
    id: "risk",
    defaultOpen: true,
    fields: [
      {
        key: "hailFrequencyZone1",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailFrequencyZone2",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailFrequencyZone3",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailFrequencyZone4",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailFrequencyZone5",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailFrequencyZone6",
        unit: "eventsPerYear",
        min: 0,
        max: 10,
        step: 0.01,
        recommended: true,
      },
      {
        key: "hailShareSmall",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.05,
        recommended: true,
      },
      {
        key: "hailShareMedium",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.05,
        recommended: true,
      },
      {
        key: "hailShareLarge",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.05,
        recommended: true,
      },
      {
        key: "hailSeveritySmallEur",
        unit: "eurPerVehicle",
        min: 0,
        max: 1_000_000,
        step: 100,
        recommended: true,
      },
      {
        key: "hailSeverityMediumEur",
        unit: "eurPerVehicle",
        min: 0,
        max: 1_000_000,
        step: 100,
        recommended: true,
      },
      {
        key: "hailSeverityLargeEur",
        unit: "eurPerVehicle",
        min: 0,
        max: 1_000_000,
        step: 100,
        recommended: true,
      },
    ],
  },
  {
    id: "portfolio",
    fields: [
      {
        key: "pmlDamageFraction10",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "pmlDamageFraction50",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "pmlDamageFraction100",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "pmlClusterRadiusKm",
        unit: "kilometers",
        min: 0.1,
        max: 1000,
        step: 5,
      },
      {
        key: "accumulationRadiusKm",
        unit: "kilometers",
        min: 0.1,
        max: 1000,
        step: 1,
        recommended: true,
        tip: true,
      },
      {
        key: "accumulationReinsureThresholdEur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
        recommended: true,
        tip: true,
      },
      {
        key: "capacityZone1Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
      },
      {
        key: "capacityZone2Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
      },
      {
        key: "capacityZone3Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
      },
      {
        key: "capacityZone4Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
      },
      {
        key: "capacityZone5Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
      },
      {
        key: "capacityZone6Eur",
        unit: "eur",
        min: 0,
        max: 1_000_000_000_000,
        step: 1000000,
      },
      {
        key: "scenarioDamageLow",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "scenarioDamageMedium",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "scenarioDamageHigh",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "scenarioDamageExtreme",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  {
    id: "quality",
    fields: [
      {
        key: "alertHailZone",
        unit: "hailZone",
        min: 1,
        max: 6,
        step: 1,
        integer: true,
        recommended: true,
        tip: true,
      },
      {
        key: "alertOvercapacity",
        unit: "factor",
        min: 0,
        max: 100,
        step: 0.05,
        recommended: true,
        tip: true,
      },
      {
        key: "alertEalPortfolioShare",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
    ],
  },
  // Thresholds of the boundary and vehicle detection: rarely touched, kept
  // apart from the business assumptions above (UX review, November 2026).
  {
    id: "advanced",
    fields: [
      {
        key: "detectionConfidence",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
        tip: true,
      },
      {
        key: "alertLowBoundaryConfidence",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "boundaryReviewConfidence",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "boundaryReviewTop2Margin",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "boundaryReviewSourceAgreement",
        unit: "fraction",
        min: 0,
        max: 1,
        step: 0.01,
      },
      {
        key: "boundaryNearPointDistanceM",
        unit: "meters",
        min: 0,
        max: 10_000,
        step: 5,
      },
      {
        key: "syntheticBoundaryRadiusM",
        unit: "meters",
        min: 1,
        max: 10_000,
        step: 10,
      },
    ],
  },
];

const FIELD_BY_KEY = new Map(
  GROUPS.flatMap((g) => g.fields).map((field) => [field.key, field]),
);

/** Shares are shown and typed in percent. */
export const isPercent = (field: ParameterField | undefined): boolean =>
  field?.unit === "fraction";

/** The stored value as the field shows it (percent for shares). */
export function displayValue(
  key: ParameterKey,
  value: number,
  locale: string,
): string {
  const field = FIELD_BY_KEY.get(key);
  return formatParameterValue(
    isPercent(field) ? toPercentDisplay(value) : value,
    locale,
  );
}

/** Validation range in the unit the user types. */
export function displayRule(field: ParameterField): ParameterField {
  return isPercent(field)
    ? { ...field, min: field.min * 100, max: (field.max ?? 1) * 100 }
    : field;
}

/** Unit label of a field (shares: "%"). */
export function unitKey(field: ParameterField): string {
  return isPercent(field) ? "percent" : field.unit;
}

/**
 * "Fahrzeugwert Pkw" and "Standard-Fahrzeugwert" read as one value: the
 * second is shown only once a portfolio holds two different ones.
 */
export function hiddenField(
  field: ParameterField,
  parameters: RiskParameters,
): boolean {
  return (
    field.key === "vehicleValueDefaultEur" &&
    parameters.vehicleValueDefaultEur === parameters.vehicleValueCarEur
  );
}

/**
 * The value as the rest of the app shows it, under the field: confirms how a
 * typed number was read ("30.000" → "30.000 €") and shows shares in percent.
 */
export function readableValue(
  field: ParameterField,
  value: number,
): string | null {
  if (!Number.isFinite(value)) return null;
  if (field.unit === "eur" && Math.abs(value) >= 10_000) return eur(value);
  return null;
}

/** Validation rule of one parameter field. */
export type ParameterInputRule = {
  min: number;
  max?: number;
  integer?: boolean;
};

export type ParameterInputError =
  | "empty"
  | "notANumber"
  | "notInteger"
  | "outOfRange";

/**
 * Why a raw field value can't be committed, or `null` when it can.
 *
 * An empty field is an error, not 0: `Number("")` is 0, which used to pass the
 * range check and silently set e.g. the vehicle value to 0 €.
 */
export function parameterInputError(
  raw: string,
  rule: ParameterInputRule,
): ParameterInputError | null {
  const trimmed = raw.trim();
  if (trimmed === "") return "empty";
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return "notANumber";
  if (rule.integer && !Number.isInteger(value)) return "notInteger";
  if (value < rule.min || (rule.max != null && value > rule.max))
    return "outOfRange";
  return null;
}

/**
 * Hail zones (2–6) whose event frequency λ is lower than the zone below.
 * λ should not fall as the zone rises; such a value is usually a typo or an
 * unfinished placeholder, so the page points it out without blocking it.
 */
export function zonesWithFallingFrequency(lambdas: number[]): number[] {
  const zones: number[] = [];
  for (let i = 1; i < lambdas.length; i++) {
    if (lambdas[i] < lambdas[i - 1]) zones.push(i + 1);
  }
  return zones;
}

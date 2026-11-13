/** Validation rule of one parameter field. */
export type ParameterInputRule = {
  min: number;
  max?: number;
  integer?: boolean;
};

export type ParameterInputError =
  "empty" | "notANumber" | "notInteger" | "outOfRange";

/** Decimal and grouping separator of a UI language ("de", "en", "fr", "de-DE" …). */
function separators(locale: string): { decimal: string; group: string } {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  const group = parts.find((p) => p.type === "group")?.value ?? ",";
  return { decimal, group };
}

const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Reads a number typed in the UI language: in German "30.000" is thirty
 * thousand and "0,15" is fifteen hundredths; in English it is the other way
 * round. A browser `type="number"` field reads "30.000" as 30, which silently
 * set the vehicle value to 30 €.
 *
 * - Whitespace (also the narrow no-break space French groups with) is ignored.
 * - The locale's grouping separator only counts as such in proper groups of
 *   three ("1.500", "25.000,5"), never after a leading 0 ("0.025").
 * - A single separator that isn't valid grouping is read as the decimal mark,
 *   so "0.15" pasted into the German UI still means 0.15.
 *
 * Returns `NaN` for anything else (letters, "1e3", two decimal marks …).
 */
export function parseLocaleNumber(raw: string, locale: string): number {
  const text = raw.replace(/\s/gu, "");
  if (text === "") return Number.NaN;
  const { decimal, group } = separators(locale);
  // Grouping in French is a space (already removed); treat "." like German.
  const groupMark = /\s/u.test(group) ? "." : group;
  const decimalMark = decimal;
  const g = escapeRegExp(groupMark);
  const d = escapeRegExp(decimalMark);
  const grouped = new RegExp(
    `^-?[1-9]\\d{0,2}(?:${g}\\d{3})+(?:${d}\\d+)?$`,
    "u",
  );
  let normalized: string;
  if (grouped.test(text)) {
    normalized = text.split(groupMark).join("").replace(decimalMark, ".");
  } else {
    // Exactly one separator of either kind: it is the decimal mark.
    const marks = text.match(/[.,]/gu) ?? [];
    if (marks.length > 1) return Number.NaN;
    normalized = text.replace(",", ".");
  }
  if (!/^-?(?:\d+\.?\d*|\.\d+)$/u.test(normalized)) return Number.NaN;
  return Number(normalized);
}

/**
 * A stored value as the field shows it, in the UI language: "25.000",
 * "0,15". Plain enough for {@link parseLocaleNumber} to read back.
 */
export function formatParameterValue(value: number, locale: string): string {
  if (!Number.isFinite(value)) return "";
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 10,
    useGrouping: true,
  }).format(value);
}

/**
 * Why a raw field value can't be committed, or `null` when it can.
 *
 * An empty field is an error, not 0: `Number("")` is 0, which used to pass the
 * range check and silently set e.g. the vehicle value to 0 €.
 */
export function parameterInputError(
  raw: string,
  rule: ParameterInputRule,
  locale = "de",
): ParameterInputError | null {
  if (raw.trim() === "") return "empty";
  const value = parseLocaleNumber(raw, locale);
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

/**
 * Numeric fact check for AI text: every number a sentence states must be a
 * figure the app computed. Pure and deterministic; the model is never asked
 * whether its own figures are right.
 */

export interface FoundNumber {
  /** The number as written, e.g. "12.345,5". */
  raw: string;
  /** Values it can stand for (German and English notation can be ambiguous). */
  candidates: number[];
  /** Decimals written, per candidate reading. */
  decimals: number[];
}

const NUMBER_PATTERN = /\d(?:[\d.,'\u00a0\u202f\u2009 ]*\d)?/g;

function readings(raw: string): Array<{ value: number; decimals: number }> {
  const compact = raw.replace(/['\u00a0\u202f\u2009 ]/g, "");
  const dots = (compact.match(/\./g) ?? []).length;
  const commas = (compact.match(/,/g) ?? []).length;
  const parse = (
    thousands: string,
    decimal: string | null,
  ): { value: number; decimals: number } => {
    let text = compact.split(thousands).join("");
    let decimals = 0;
    if (decimal) {
      const at = text.lastIndexOf(decimal);
      if (at >= 0) {
        decimals = text.length - at - 1;
        text = `${text.slice(0, at)}.${text.slice(at + 1)}`;
      }
    }
    return { value: Number(text), decimals };
  };
  if (dots === 0 && commas === 0) return [parse(",", null)];
  if (dots > 0 && commas > 0) {
    // The separator written last is the decimal one.
    return compact.lastIndexOf(",") > compact.lastIndexOf(".")
      ? [parse(".", ",")]
      : [parse(",", ".")];
  }
  const separator = dots > 0 ? "." : ",";
  const count = dots + commas;
  if (count > 1) return [parse(separator, null)]; // 1.234.567
  const digitsAfter = compact.length - compact.indexOf(separator) - 1;
  const asDecimal = parse(separator === "." ? "," : ".", separator);
  // "12.345" can be twelve thousand (de) or twelve point three (en).
  return digitsAfter === 3 ? [parse(separator, null), asDecimal] : [asDecimal];
}

/** Numbers stated in a text. List markers ("1." at a line start) are not figures. */
export function extractNumbers(text: string): FoundNumber[] {
  const withoutMarkers = text.replace(/^\s*\d{1,2}[.)]\s/gm, " ");
  const found: FoundNumber[] = [];
  for (const match of withoutMarkers.matchAll(NUMBER_PATTERN)) {
    // Spaces group digits only in threes ("12 345"); "5 2024" is two numbers.
    const pieces = /[\u00a0\u202f\u2009 ]/.test(match[0])
      ? splitLooseGroups(match[0])
      : [match[0]];
    for (const raw of pieces) {
      const options = readings(raw).filter((r) => Number.isFinite(r.value));
      if (options.length === 0) continue;
      found.push({
        raw,
        candidates: options.map((o) => o.value),
        decimals: options.map((o) => o.decimals),
      });
    }
  }
  return found;
}

function splitLooseGroups(raw: string): string[] {
  const parts = raw.split(/[\u00a0\u202f\u2009 ]+/);
  const grouped = parts.every((part, i) =>
    (i === 0 ? /^\d{1,3}$/ : /^\d{3}([.,]\d+)?$/).test(part),
  );
  return grouped && parts.length > 1 ? [raw] : parts.filter(Boolean);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Whether a written number is one of the allowed values: exactly, or the
 * value rounded to the decimals written ("4,3 %" for 4.27), or a share
 * written as a percentage (0.35 → "35").
 */
export function isSupportedNumber(
  found: FoundNumber,
  allowed: readonly number[],
): boolean {
  return found.candidates.some((candidate, i) =>
    allowed.some((value) => {
      const decimals = found.decimals[i] ?? 0;
      if (Math.abs(roundTo(value, decimals) - candidate) < 1e-9) return true;
      return (
        value > 0 &&
        value <= 1 &&
        Math.abs(roundTo(value * 100, decimals) - candidate) < 1e-9
      );
    }),
  );
}

export interface NumberCheck {
  ok: boolean;
  /** Numbers that are not among the allowed values, as written. */
  unsupported: string[];
}

export function checkNumbers(
  text: string,
  allowed: readonly number[],
): NumberCheck {
  const unsupported = extractNumbers(text)
    .filter((found) => !isSupportedNumber(found, allowed))
    .map((found) => found.raw);
  return { ok: unsupported.length === 0, unsupported };
}

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
  /** Unit written next to the number, when it is a share or an amount. */
  unit?: "percent" | "currency";
}

const PERCENT_AFTER = /^\s*(%|prozent\b|percent\b|pour\s?cent\b)/i;
const CURRENCY_AFTER =
  /^\s*(€|\$|eur(?:o|os)?\b|usd\b|chf\b|mio\b|mill?ion(?:en|s)?\b|mrd\b|milliarden?\b|tsd\b|tausend\b|thousand\b)/i;
const CURRENCY_BEFORE = /(€|\$|\beur|\beuro|\busd|\bchf)\s*$/i;

function unitAround(
  text: string,
  start: number,
  end: number,
): FoundNumber["unit"] {
  const after = text.slice(end, end + 16);
  if (PERCENT_AFTER.test(after)) return "percent";
  if (CURRENCY_AFTER.test(after)) return "currency";
  return CURRENCY_BEFORE.test(text.slice(Math.max(0, start - 8), start))
    ? "currency"
    : undefined;
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
    const start = match.index ?? 0;
    const unit = unitAround(withoutMarkers, start, start + match[0].length);
    for (const [index, raw] of pieces.entries()) {
      const options = readings(raw).filter((r) => Number.isFinite(r.value));
      if (options.length === 0) continue;
      found.push({
        raw,
        candidates: options.map((o) => o.value),
        decimals: options.map((o) => o.decimals),
        // The unit stands after the last piece ("5 2024 €" is rare enough).
        ...(unit && index === pieces.length - 1 ? { unit } : {}),
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
  options: { shares?: boolean } = {},
): boolean {
  const shares = options.shares ?? true;
  return found.candidates.some((candidate, i) =>
    allowed.some((value) => {
      const decimals = found.decimals[i] ?? 0;
      if (Math.abs(roundTo(value, decimals) - candidate) < 1e-9) return true;
      return (
        shares &&
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

export interface NumberCheckOptions {
  /**
   * Whether a value of at most 1 may be written as its percentage
   * (0.35 → "35"). Off where no allowed value is a share: a frequency of
   * 0.12 per year is not "12 %".
   */
  shares?: boolean;
  /**
   * When set, a number written with a percent unit must be one of these
   * (and nothing else): "6 %" is not supported by a hail zone of 6.
   */
  percentAllowed?: readonly number[];
  /** Bare whole numbers up to twelve count as wording ("the 3 largest"). */
  smallCounts?: boolean;
}

export function checkNumbers(
  text: string,
  allowed: readonly number[],
  options: NumberCheckOptions = {},
): NumberCheck {
  const shares = options.shares ?? true;
  const supported = (found: FoundNumber): boolean => {
    if (options.percentAllowed && found.unit === "percent")
      return isSupportedNumber(found, options.percentAllowed, {
        shares: false,
      });
    if (
      options.smallCounts &&
      !found.unit &&
      found.candidates.some((n) => Number.isInteger(n) && n >= 0 && n <= 12)
    )
      return true;
    return isSupportedNumber(found, allowed, { shares });
  };
  const unsupported = extractNumbers(text)
    .filter((found) => !supported(found))
    .map((found) => found.raw);
  return { ok: unsupported.length === 0, unsupported };
}

/** Dates as three plain numbers, so "14.11.2026" is not read as one figure. */
function spellOutDates(text: string): string {
  return text
    .replace(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/g, "$3 / $2 / $1")
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, "$1 / $2 / $3");
}

/** A number word with a unit: "zwanzigtausend Euro", "three hundred percent". */
const NUMBER_WORD_FIGURE =
  /\b[\p{L}-]*(tausend|hundert|million|milliard|thousand|hundred|mille)[\p{L}-]*\s+(euros?\b|eur\b|€|prozent\b|percent\b|pour\s?cent\b)/iu;

export function containsNumberWordFigure(text: string): boolean {
  return NUMBER_WORD_FIGURE.test(text);
}

/**
 * For free AI text written about facts the app computed: keeps the
 * sentences whose figures all occur in `source` (the facts given to the
 * model) and drops the others. A sentence is a line or a part of one ending
 * in ".", "!" or "?"; bare numbers up to twelve count as wording.
 */
export function keepSupportedSentences(
  text: string,
  source: string,
): { text: string; removed: number } {
  const allowed = extractNumbers(spellOutDates(source)).flatMap(
    (found) => found.candidates,
  );
  let removed = 0;
  const lines = text.split("\n").map((line) => {
    if (!/\d/.test(line) && !containsNumberWordFigure(line)) return line;
    const kept = line
      .split(/(?<=[.!?])\s+(?=[\p{Lu}"„«(])/u)
      .filter((sentence) => {
        const ok =
          !containsNumberWordFigure(sentence) &&
          checkNumbers(spellOutDates(sentence), allowed, {
            shares: false,
            smallCounts: true,
          }).ok;
        if (!ok) removed++;
        return ok;
      });
    return kept.length > 0 ? kept.join(" ") : null;
  });
  return {
    text: lines.filter((line): line is string => line !== null).join("\n"),
    removed,
  };
}

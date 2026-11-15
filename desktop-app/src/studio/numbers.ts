/**
 * Numbers, dates and durations of the studio: always in the interface
 * language (Intl), and number fields parsed from the text you typed, never
 * coerced.
 */
import i18n, { locale } from "./i18n";

/** Same range as studio.py build_round. */
export const ROUND_EPOCHS = { min: 3, max: 120 } as const;
/** Same range as studio.py build_job("train"). */
export const TRAIN_EPOCHS = { min: 1, max: 300 } as const;

/**
 * A whole number in [min, max] typed into a field, or null when the field is
 * empty, has a decimal or exponent, or is out of range. (Number("") is 0,
 * which is why the fields keep their text instead of a number.)
 */
export function parseWhole(
  text: string,
  min: number,
  max: number,
): number | null {
  if (!/^\s*\d+\s*$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

/** A number with a fixed number of decimals, or "–" when there is none. */
export const fmt = (n: number | null | undefined, digits = 0): string =>
  n == null
    ? "–"
    : n.toLocaleString(locale(), {
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      });

/** A signed share as a percentage ("+0,2 %", "+0.2%", "+0,2 %"). */
export const pct = (n: number | null | undefined, digits = 1): string =>
  n == null
    ? "–"
    : new Intl.NumberFormat(locale(), {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
        signDisplay: "exceptZero",
      }).format(n);

/** An unsigned share as a percentage ("73 %", "73%"). */
export const share = (n: number | null | undefined, digits = 0): string =>
  n == null
    ? "–"
    : new Intl.NumberFormat(locale(), {
        style: "percent",
        minimumFractionDigits: digits,
        maximumFractionDigits: digits,
      }).format(n);

/**
 * A studio timestamp (local ISO time, "2026-11-14T13:46:40") as date and
 * time in the interface language: "medium" (14. Nov. 2026, 13:46), "short"
 * (14.11.26, 13:46) for tables, or "time" for the end of a job that started
 * the same day. Unparseable values are shown as they are.
 */
export function dateTime(
  iso: string | null | undefined,
  style: "medium" | "short" | "time" = "medium",
): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(
    locale(),
    style === "time"
      ? { timeStyle: "short" }
      : { dateStyle: style, timeStyle: "short" },
  ).format(d);
}

/** True when two studio timestamps fall on the same calendar day. */
export const sameDay = (a: string, b: string): boolean =>
  a.slice(0, 10) === b.slice(0, 10);

/** "etwa 31 Minuten" / "about 2.5 hours" (never negative). */
export function duration(minutes: number): string {
  const m = Math.max(0, minutes);
  if (m < 90) return i18n.t("duration.minutes", { count: Math.round(m) });
  const h = Math.round(m / 30) / 2;
  return i18n.t("duration.hours", {
    count: h,
    hours: h.toLocaleString(locale(), { maximumFractionDigits: 1 }),
  });
}

/**
 * Evenly spaced axis ticks on a 1-2-5 step that cover [min, max], and the
 * decimals that show every tick distinctly (so a chart never labels
 * 0.875 and 0.9 both as "0.88" and "0.90").
 */
export function niceTicks(
  min: number,
  max: number,
  target = 5,
): { ticks: number[]; digits: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max))
    return { ticks: [], digits: 0 };
  if (min === max) {
    const pad = Math.abs(min) * 0.05 || 1;
    min -= pad;
    max += pad;
  }
  const raw = (max - min) / Math.max(1, target - 1);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step =
    [1, 2, 5, 10].map((f) => f * mag).find((s) => s >= raw) ?? 10 * mag;
  const start = Math.floor(min / step + 1e-9) * step;
  const end = Math.ceil(max / step - 1e-9) * step;
  let digits = 0;
  while (
    digits < 10 &&
    Math.abs(Math.round(step * 10 ** digits) - step * 10 ** digits) > 1e-6
  )
    digits += 1;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step)
    ticks.push(Number(v.toFixed(digits + 2)));
  return { ticks, digits };
}

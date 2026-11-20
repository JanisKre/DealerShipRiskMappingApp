import type { AsIfDay, AsIfYear, CandidateDay } from "@shared/as-if-history";

/** A year of the chart; `checked` is false when no day of it was loaded. */
export interface AsIfYearBar extends AsIfYear {
  label: string;
  checked: boolean;
}

/**
 * Every year from the first to the last evaluated one. Years in between
 * without a loaded day are kept as unchecked bars, so a gap reads as "not
 * checked" instead of looking loss-free.
 */
export function yearBars(years: readonly AsIfYear[]): AsIfYearBar[] {
  if (years.length === 0) return [];
  const byYear = new Map(years.map((y) => [y.year, y]));
  const first = Math.min(...byYear.keys());
  const last = Math.max(...byYear.keys());
  const bars: AsIfYearBar[] = [];
  for (let year = first; year <= last; year++) {
    const known = byYear.get(year);
    bars.push({
      ...(known ?? {
        year,
        days: 0,
        hitDays: 0,
        lossEur: 0,
        worstDay: null,
        worstDayLossEur: 0,
      }),
      label: String(year),
      checked: known != null,
    });
  }
  return bars;
}

/** Days with the largest loss first, then newest first. */
export function daysByLoss(days: readonly AsIfDay[]): AsIfDay[] {
  return [...days].sort(
    (a, b) => b.lossEur - a.lossEur || b.day.localeCompare(a.day),
  );
}

/** The day with the largest loss; null when no day caused one. */
export function worstDay(days: readonly AsIfDay[]): AsIfDay | null {
  const top = daysByLoss(days)[0];
  return top && top.lossEur > 0 ? top : null;
}

/** The year with the largest loss; null when no year has one. */
export function worstYear(years: readonly AsIfYear[]): AsIfYear | null {
  const top = [...years].sort(
    (a, b) => b.lossEur - a.lossEur || b.year - a.year,
  )[0];
  return top && top.lossEur > 0 ? top : null;
}

/** The next `count` proposed days that are not loaded yet, best first. */
export function nextToLoad(
  candidates: readonly CandidateDay[],
  count: number,
): string[] {
  return candidates
    .filter((c) => !c.loaded)
    .slice(0, count)
    .map((c) => c.day);
}

/** A UTC day (YYYY-MM-DD) as a date in the UI's locale. */
export function dayLabel(day: string, locale: string): string {
  const t = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(t)) return day;
  return new Date(t).toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Latest day that can be asked for: yesterday (UTC), as on the map. */
export function latestLoadableDay(now = Date.now()): string {
  return new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

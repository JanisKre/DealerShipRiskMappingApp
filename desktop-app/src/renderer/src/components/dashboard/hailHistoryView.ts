import type { HailHistoryStation } from "@shared/types";

/**
 * Pure figures behind the hail history panel: the year series with gaps for
 * years without enough observations, hail days per calendar month, the key
 * figures and the notes that qualify them. Kept free of React for tests.
 */

/** One bar of the year chart; `days` is null when the year was not observed. */
export interface YearBar {
  year: number;
  days: number | null;
  /** Hail dates of the year (YYYY-MM-DD), oldest first. */
  dates: string[];
}

export type YearRange = "all" | "recent";
/** Years shown by the "recent" range. */
export const RECENT_YEARS = 30;

export function yearBars(
  station: HailHistoryStation,
  range: YearRange,
): YearBar[] {
  const observed = new Map(
    station.hailDaysByYear.map((entry) => [entry.year, entry.days]),
  );
  const datesByYear = new Map<number, string[]>();
  for (const date of station.hailDates ?? []) {
    const year = Number(date.slice(0, 4));
    datesByYear.set(year, [...(datesByYear.get(year) ?? []), date]);
  }
  const first =
    range === "recent"
      ? Math.max(station.firstYear, station.lastYear - RECENT_YEARS + 1)
      : station.firstYear;
  const bars: YearBar[] = [];
  for (let year = first; year <= station.lastYear; year++) {
    bars.push({
      year,
      days: observed.get(year) ?? null,
      dates: datesByYear.get(year) ?? [],
    });
  }
  return bars;
}

export interface MonthBar {
  /** 0 = January. */
  month: number;
  days: number;
  /** Share of all hail days. */
  share: number;
  /** Hail dates in this month, newest first. */
  dates: string[];
}

export function monthBars(station: HailHistoryStation): MonthBar[] {
  const dates = station.hailDates ?? [];
  const byMonth: string[][] = Array.from({ length: 12 }, () => []);
  for (const date of dates) byMonth[Number(date.slice(5, 7)) - 1]?.push(date);
  return byMonth.map((list, month) => ({
    month,
    days: list.length,
    share: dates.length > 0 ? list.length / dates.length : 0,
    dates: [...list].reverse(),
  }));
}

export interface HailFigures {
  perYear: number;
  yearsWithHail: number;
  yearsObserved: number;
  /** Year with the most hail days (the latest on ties); null without hail. */
  peak: { year: number; days: number } | null;
  lastHail: string | null;
  /** Months with at least half of all hail days, in calendar order. */
  mainMonths: number[];
}

export function hailFigures(station: HailHistoryStation): HailFigures {
  let peak: HailFigures["peak"] = null;
  for (const entry of station.hailDaysByYear) {
    if (entry.days > 0 && (!peak || entry.days >= peak.days)) peak = entry;
  }
  // Smallest set of months that holds at least half of the hail days.
  const months = monthBars(station)
    .filter((m) => m.days > 0)
    .sort((a, b) => b.days - a.days || a.month - b.month);
  const total = months.reduce((sum, m) => sum + m.days, 0);
  const main: number[] = [];
  let covered = 0;
  for (const m of months) {
    if (covered >= total / 2) break;
    main.push(m.month);
    covered += m.days;
  }
  return {
    perYear: station.hailDaysPerYear,
    yearsWithHail: station.hailDaysByYear.filter((e) => e.days > 0).length,
    yearsObserved: station.yearsObserved,
    peak: peak ? { year: peak.year, days: peak.days } : null,
    lastHail: station.recentHailDates[0] ?? null,
    mainMonths: main.sort((a, b) => a - b),
  };
}

/** Notes that qualify the figures of one station, most important first. */
export type HailNote =
  | { kind: "ended"; lastYear: number; yearsAgo: number }
  | { kind: "far"; distanceKm: number }
  | { kind: "short"; years: number }
  | { kind: "gaps"; missing: number };

/** Station farther than this: local differences become likely. */
export const FAR_STATION_KM = 10;
/** Fewer observed years: the mean is uncertain. */
export const SHORT_RECORD_YEARS = 20;
/** Record ending more than this many years ago is called out. */
const ENDED_AFTER_YEARS = 3;

export function hailNotes(
  station: HailHistoryStation,
  currentYear: number,
): HailNote[] {
  const notes: HailNote[] = [];
  const yearsAgo = currentYear - station.lastYear;
  if (yearsAgo > ENDED_AFTER_YEARS)
    notes.push({ kind: "ended", lastYear: station.lastYear, yearsAgo });
  if (station.distanceKm > FAR_STATION_KM)
    notes.push({ kind: "far", distanceKm: station.distanceKm });
  if (station.yearsObserved < SHORT_RECORD_YEARS)
    notes.push({ kind: "short", years: station.yearsObserved });
  const span = station.lastYear - station.firstYear + 1;
  const missing = span - station.yearsObserved;
  if (missing > 0) notes.push({ kind: "gaps", missing });
  return notes;
}

/** Axis ticks on round counts from 0 to a little above `max`. */
export function countTicks(max: number): number[] {
  const step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : 10;
  const top = Math.max(step, Math.ceil(max / step) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return ticks;
}

/**
 * Another nearby station whose record reaches later than this one's, the
 * latest first — offered when the shown station stopped observing early.
 */
export function newerStation(
  stations: HailHistoryStation[],
  current: HailHistoryStation,
): HailHistoryStation | null {
  return (
    stations
      .filter(
        (s) =>
          s.stationId !== current.stationId && s.lastYear > current.lastYear,
      )
      .sort(
        (a, b) => b.lastYear - a.lastYear || a.distanceKm - b.distanceKm,
      )[0] ?? null
  );
}

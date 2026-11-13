import { describe, expect, it } from "vitest";
import type { HailHistoryStation } from "@shared/types";
import { hailFigures, hailNotes, monthBars, yearBars } from "./hailHistoryView";

const station: HailHistoryStation = {
  stationId: "01048",
  name: "Dresden-Klotzsche",
  distanceKm: 8.4,
  firstYear: 1970,
  lastYear: 2011,
  yearsObserved: 40,
  hailDays: 5,
  hailDaysPerYear: 0.13,
  recentHailDates: ["2010-05-28", "2009-07-04", "2009-06-12"],
  hailDaysByYear: [
    ...Array.from({ length: 42 }, (_, i) => ({
      year: 1970 + i,
      days: 0,
    })).filter((e) => e.year !== 1990 && e.year !== 1991),
  ].map((e) =>
    e.year === 1985
      ? { ...e, days: 2 }
      : e.year === 2009
        ? { ...e, days: 2 }
        : e.year === 2010
          ? { ...e, days: 1 }
          : e,
  ),
  hailDates: [
    "1985-06-01",
    "1985-07-15",
    "2009-06-12",
    "2009-07-04",
    "2010-05-28",
  ],
};

describe("hail history view", () => {
  it("fills every year and marks unobserved ones as gaps", () => {
    const bars = yearBars(station, "all");
    expect(bars).toHaveLength(42);
    expect(bars.find((b) => b.year === 1990)?.days).toBeNull();
    expect(bars.find((b) => b.year === 1989)?.days).toBe(0);
    expect(bars.find((b) => b.year === 2009)).toEqual({
      year: 2009,
      days: 2,
      dates: ["2009-06-12", "2009-07-04"],
    });
  });

  it("limits the recent range to the last 30 years of the record", () => {
    const bars = yearBars(station, "recent");
    expect(bars[0].year).toBe(1982);
    expect(bars.at(-1)?.year).toBe(2011);
  });

  it("counts hail days per calendar month", () => {
    const months = monthBars(station);
    expect(months.map((m) => m.days)).toEqual([
      0, 0, 0, 0, 1, 2, 2, 0, 0, 0, 0, 0,
    ]);
    expect(months[5].share).toBeCloseTo(0.4);
    expect(months[6].dates).toEqual(["2009-07-04", "1985-07-15"]);
  });

  it("derives the key figures", () => {
    expect(hailFigures(station)).toEqual({
      perYear: 0.13,
      yearsWithHail: 3,
      yearsObserved: 40,
      // Ties go to the latest year.
      peak: { year: 2009, days: 2 },
      lastHail: "2010-05-28",
      mainMonths: [5, 6],
    });
  });

  it("qualifies an old, distant or patchy record", () => {
    expect(hailNotes(station, 2026)).toEqual([
      { kind: "ended", lastYear: 2011, yearsAgo: 15 },
      { kind: "gaps", missing: 2 },
    ]);
    expect(
      hailNotes(
        {
          ...station,
          distanceKm: 24,
          yearsObserved: 12,
          firstYear: 2000,
          lastYear: 2011,
        },
        2012,
      ),
    ).toEqual([
      { kind: "far", distanceKm: 24 },
      { kind: "short", years: 12 },
    ]);
  });
});

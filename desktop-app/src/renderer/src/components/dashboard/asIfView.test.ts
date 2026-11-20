import { describe, expect, it } from "vitest";
import type { AsIfDay, AsIfYear } from "@shared/as-if-history";
import {
  dayLabel,
  daysByLoss,
  latestLoadableDay,
  nextToLoad,
  worstDay,
  worstYear,
  yearBars,
} from "./asIfView";

const year = (y: number, lossEur: number, days = 1): AsIfYear => ({
  year: y,
  days,
  hitDays: lossEur > 0 ? 1 : 0,
  lossEur,
  worstDay: lossEur > 0 ? `${y}-07-01` : null,
  worstDayLossEur: lossEur,
});

const day = (d: string, lossEur: number): AsIfDay => ({
  day: d,
  eventIds: [`radklim-${d.replaceAll("-", "")}`],
  sources: ["radklim"],
  hitCount: lossEur > 0 ? 1 : 0,
  exposureEur: lossEur * 5,
  lossEur,
  maxClass: lossEur > 0 ? "hail" : null,
  hits: [],
});

describe("yearBars", () => {
  it("fills the years between the first and last as unchecked", () => {
    const bars = yearBars([year(2008, 100), year(2011, 0)]);
    expect(bars.map((b) => [b.label, b.checked, b.days])).toEqual([
      ["2008", true, 1],
      ["2009", false, 0],
      ["2010", false, 0],
      ["2011", true, 1],
    ]);
  });

  it("is empty without years", () => {
    expect(yearBars([])).toEqual([]);
  });
});

describe("worst day and year", () => {
  it("picks the largest loss, the newer one on a tie", () => {
    const days = [
      day("2008-05-30", 500),
      day("2013-07-28", 900),
      day("2019-06-10", 900),
    ];
    expect(daysByLoss(days).map((d) => d.day)).toEqual([
      "2019-06-10",
      "2013-07-28",
      "2008-05-30",
    ]);
    expect(worstDay(days)?.day).toBe("2019-06-10");
    expect(worstYear([year(2008, 500), year(2013, 900)])?.year).toBe(2013);
  });

  it("has none when nothing was reached", () => {
    expect(worstDay([day("2005-08-01", 0)])).toBeNull();
    expect(worstYear([year(2005, 0)])).toBeNull();
    expect(worstDay([])).toBeNull();
  });
});

describe("loading days", () => {
  it("takes the next days that are not loaded", () => {
    const candidates = ["a", "b", "c", "d"].map((d, i) => ({
      day: d,
      stations: 1,
      sites: 1,
      exposureEur: 10 - i,
      loaded: i === 1,
    }));
    expect(nextToLoad(candidates, 2)).toEqual(["a", "c"]);
    expect(nextToLoad(candidates, 10)).toEqual(["a", "c", "d"]);
  });

  it("formats a UTC day without shifting it", () => {
    expect(dayLabel("2013-07-28", "de-DE")).toBe("28.07.2013");
    expect(dayLabel("2013-07-28", "en-GB")).toBe("28/07/2013");
    expect(dayLabel("nonsense", "de-DE")).toBe("nonsense");
  });

  it("allows days up to yesterday", () => {
    expect(latestLoadableDay(Date.parse("2026-11-20T08:00:00Z"))).toBe(
      "2026-11-19",
    );
  });
});

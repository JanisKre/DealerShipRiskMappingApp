import { describe, expect, it } from "vitest";
import type { HailHistoryStation } from "@shared/types";
import { newerStation } from "./hailHistoryView";

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
  hailDaysByYear: [],
  hailDates: [],
};

describe("hail history view", () => {
  it("offers the nearby station with the latest record", () => {
    const later = {
      ...station,
      stationId: "00433",
      name: "B",
      lastYear: 1991,
      distanceKm: 5.6,
    };
    const latest = {
      ...station,
      stationId: "00400",
      name: "C",
      lastYear: 2020,
      distanceKm: 9,
    };
    const early = { ...station, stationId: "00401", name: "D", lastYear: 1960 };
    expect(
      newerStation([station, later, latest, early], station)?.stationId,
    ).toBe("00400");
    expect(newerStation([station, early], station)).toBeNull();
  });

  it("prefers the nearer of two stations that end in the same year", () => {
    const far = { ...station, stationId: "a", lastYear: 2020, distanceKm: 12 };
    const near = { ...station, stationId: "b", lastYear: 2020, distanceKm: 4 };
    expect(newerStation([station, far, near], station)?.stationId).toBe("b");
  });
});

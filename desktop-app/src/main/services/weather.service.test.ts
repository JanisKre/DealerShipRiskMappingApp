import { describe, expect, it } from "vitest";
import {
  capeSeasons,
  dailyMaxCape,
  hailProxyFromDailyCape,
} from "./weather.service";

describe("capeSeasons", () => {
  it("uses the last three complete summer half-years", () => {
    expect(capeSeasons(new Date("2026-11-19T12:00:00Z"))).toEqual([
      2024, 2025, 2026,
    ]);
  });

  it("does not count a season before it has ended", () => {
    expect(capeSeasons(new Date("2026-08-15T12:00:00Z"))).toEqual([
      2023, 2024, 2025,
    ]);
    expect(capeSeasons(new Date("2026-01-10T12:00:00Z"))).toEqual([
      2023, 2024, 2025,
    ]);
  });

  it("gives the same seasons for winter and late summer of one year", () => {
    // The 92-day window gave zone 1 in winter and up to zone 6 in August.
    expect(capeSeasons(new Date("2026-02-01T00:00:00Z"))).toEqual(
      capeSeasons(new Date("2026-09-30T23:00:00Z")),
    );
  });
});

describe("dailyMaxCape", () => {
  it("takes the daily maximum and keeps only April to September", () => {
    const times = [
      "2025-03-31T12:00",
      "2025-04-01T10:00",
      "2025-04-01T15:00",
      "2025-09-30T15:00",
      "2025-10-01T15:00",
    ];
    expect(dailyMaxCape(times, [3000, 200, 1800, 900, 2500])).toEqual([
      1800, 900,
    ]);
  });

  it("skips hours without a value instead of counting them as calm", () => {
    const times = ["2025-07-01T10:00", "2025-07-02T10:00", "2025-07-02T11:00"];
    expect(dailyMaxCape(times, [null, null, 1600])).toEqual([1600]);
  });

  it("returns nothing without data", () => {
    expect(dailyMaxCape(undefined, undefined)).toEqual([]);
  });
});

describe("hailProxyFromDailyCape", () => {
  it("clamps calm seasons to 5 %", () => {
    expect(hailProxyFromDailyCape([100, 200, 300])).toBe(0.05);
    expect(hailProxyFromDailyCape([])).toBe(0.05);
  });

  it("scales hail-prone and thunder-prone day shares", () => {
    // 1 of 10 days ≥ 1500, 2 of 10 days ≥ 1000: 0.1·3 + 0.2·0.3 = 0.36.
    const days = [1600, 1200, 0, 0, 0, 0, 0, 0, 0, 0];
    expect(hailProxyFromDailyCape(days)).toBeCloseTo(0.36, 10);
  });

  it("caps at 90 %", () => {
    expect(hailProxyFromDailyCape([2000, 2000])).toBe(0.9);
  });
});

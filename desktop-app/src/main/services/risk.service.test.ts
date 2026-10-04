import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  statement: { get: vi.fn(), run: vi.fn() },
  fetchWeather: vi.fn(),
}));

vi.mock("../db/database", () => ({
  getDb: () => ({ prepare: vi.fn(() => mocks.statement) }),
}));

vi.mock("./weather.service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./weather.service")>();
  return { ...actual, fetchWeather: mocks.fetchWeather };
});

import { scoreRisk } from "./risk.service";

const REAL_WEATHER = {
  maxWindKmh: 50,
  annualPrecipMm: 800,
  maxSnowDepthCm: 5,
  lightningDensity: 1,
  hailProbability: 0.2,
  maxTempC: 28,
  hotDays: 10,
};

describe("scoreRisk weather resilience", () => {
  it("does not abort the analysis when the weather lookup fails", async () => {
    // A transient Open-Meteo outage/503 must not take down a result that
    // boundary detection and vehicle counting already computed successfully.
    mocks.fetchWeather.mockRejectedValue(new Error("Open-Meteo 503"));

    const result = await scoreRisk(52.5, 13.4, 100_000);

    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    const weatherEvidence = result.evidence?.find(
      (e) => e.source === "Open-Meteo",
    );
    expect(weatherEvidence?.fallbackUsed).toBe(true);
    expect(weatherEvidence?.confidence).toBeLessThan(0.55);
  });

  it("does not flag a fallback when the weather lookup succeeds", async () => {
    mocks.fetchWeather.mockResolvedValue(REAL_WEATHER);

    const result = await scoreRisk(52.5, 13.4, 100_000);

    const weatherEvidence = result.evidence?.find(
      (e) => e.source === "Open-Meteo",
    );
    expect(weatherEvidence?.fallbackUsed).toBe(false);
    expect(weatherEvidence?.confidence).toBe(0.55);
  });
});

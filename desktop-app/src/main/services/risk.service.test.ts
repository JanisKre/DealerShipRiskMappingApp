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

const REAL_WEATHER = { hailProbability: 0.2 };

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

describe("scoreRisk weather lookup", () => {
  it("does not fetch weather when the postcode zone decides the score", async () => {
    mocks.fetchWeather.mockClear();

    const result = await scoreRisk(
      52.5,
      13.4,
      100_000,
      undefined,
      undefined,
      3,
    );

    expect(mocks.fetchWeather).not.toHaveBeenCalled();
    expect(result.evidence?.some((e) => e.source === "Open-Meteo")).toBe(false);
    expect(
      result.evidence?.find((e) => e.source === "Postcode hail zones")
        ?.dataVersion,
    ).toContain("2024");
  });

  it("caps the overall confidence while λ, p and S are placeholders", async () => {
    mocks.fetchWeather.mockResolvedValue(REAL_WEATHER);

    const result = await scoreRisk(
      52.5,
      13.4,
      100_000,
      undefined,
      undefined,
      3,
    );

    expect(result.confidence).toBeLessThanOrEqual(0.6);
  });
});

describe("scoreRisk perils", () => {
  it("scores hail only", async () => {
    mocks.fetchWeather.mockResolvedValue(REAL_WEATHER);

    const result = await scoreRisk(52.5, 13.4, 100_000);

    expect(result.perils.map((p) => p.peril)).toEqual(["hail"]);
    expect(result.overallScore).toBe(20);
  });
});

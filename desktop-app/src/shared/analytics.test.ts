import { describe, expect, it } from "vitest";
import type { AnalyzedDealership, PerilScore } from "./types";
import { PERILS } from "./types";
import {
  computeCoverage,
  computeSeasonalProfile,
  detectAnomalies,
  generateAlerts,
} from "./analytics";

/** Builds a minimal analyzed dataset for the tests. */
function make(
  id: string,
  opts: {
    lat?: number;
    lon?: number;
    score?: number;
    eal?: number;
    utilisation?: number;
    perilScores?: Partial<Record<(typeof PERILS)[number], number>>;
    vehicleCount?: number;
    boundaryConfidence?: number;
  } = {},
): AnalyzedDealership {
  const perils: PerilScore[] = PERILS.map((peril) => ({
    peril,
    score: opts.perilScores?.[peril] ?? 0,
    hazardValue: 0,
    unit: "x",
  }));
  return {
    id,
    name: `D-${id}`,
    lat: opts.lat ?? 51,
    lon: opts.lon ?? 10,
    risk:
      opts.score != null || opts.eal != null || opts.utilisation != null
        ? {
            overallScore: opts.score ?? 0,
            perils,
            eal: opts.eal ?? 0,
            utilisation: opts.utilisation,
            exposureEur: opts.eal ?? 0,
            computedAt: "2026-01-01T00:00:00.000Z",
          }
        : undefined,
    detection:
      opts.vehicleCount != null
        ? { vehicleCount: opts.vehicleCount, confidence: 0.9, model: "test" }
        : undefined,
    boundary:
      opts.boundaryConfidence != null
        ? {
            source: "synthetic",
            polygon: {
              type: "Polygon",
              coordinates: [
                [
                  [10, 51],
                  [10, 51],
                  [10, 51],
                ],
              ],
            },
            areaSqm: 1000,
            confidence: opts.boundaryConfidence,
          }
        : undefined,
  };
}

describe("detectAnomalies", () => {
  it("flags a high-score outlier as an anomaly", () => {
    const ds = [
      ...Array.from({ length: 9 }, (_, i) => make(`n${i}`, { score: 10 })),
      make("out", { score: 90 }), // clear outlier
    ];
    const anomalies = detectAnomalies(ds);
    expect(
      anomalies.some((a) => a.dealershipId === "out" && a.metric === "score"),
    ).toBe(true);
  });

  it("returns nothing when fewer than 3 samples", () => {
    expect(
      detectAnomalies([make("1", { score: 10 }), make("2", { score: 90 })]),
    ).toEqual([]);
  });
});

describe("generateAlerts", () => {
  it("raises extreme-risk and high-eal alerts", () => {
    const ds = [
      make("1", { score: 90, eal: 900 }),
      make("2", { score: 10, eal: 100 }),
    ];
    const alerts = generateAlerts(ds);
    expect(
      alerts.some((a) => a.kind === "extreme-risk" && a.dealershipId === "1"),
    ).toBe(true);
    expect(
      alerts.some((a) => a.kind === "high-eal" && a.dealershipId === "1"),
    ).toBe(true);
  });

  it("warns on overcapacity, low boundary confidence and no detection", () => {
    const ds = [
      make("1", {
        score: 10,
        utilisation: 1.5,
        boundaryConfidence: 0.1,
        vehicleCount: 0,
      }),
    ];
    const kinds = new Set(generateAlerts(ds).map((a) => a.kind));
    expect(kinds.has("overcapacity")).toBe(true);
    expect(kinds.has("low-boundary-confidence")).toBe(true);
    expect(kinds.has("no-detection")).toBe(true);
  });
});

describe("computeCoverage", () => {
  it("computes per-peril average and concentration", () => {
    const ds = [
      make("1", { score: 60, eal: 100, perilScores: { hail: 80 } }),
      make("2", { score: 20, eal: 100, perilScores: { hail: 20 } }),
    ];
    const report = computeCoverage(ds);
    const hail = report.perils.find((p) => p.peril === "hail");
    expect(hail?.avgScore).toBe(50);
    expect(hail?.highShare).toBe(0.5);
    // Two equally sized EAL contributions => HHI = 0.5, effectively 2 locations.
    expect(report.concentration.herfindahl).toBeCloseTo(0.5, 5);
    expect(report.concentration.effectiveLocations).toBeCloseTo(2, 5);
  });
});

describe("computeSeasonalProfile", () => {
  it("produces 12 months with a summer hail peak", () => {
    const ds = [make("1", { score: 50, perilScores: { hail: 100 } })];
    const profile = computeSeasonalProfile(ds);
    expect(profile).toHaveLength(12);
    const july = profile[6];
    const january = profile[0];
    expect(july.hail).toBeGreaterThan(january.hail);
  });
});

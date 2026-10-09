import { describe, expect, it } from "vitest";
import type { AnalyzedDealership, HailZone, PerilScore } from "./types";
import { PERILS } from "./types";
import {
  alertIdSet,
  computeCoverage,
  computeSeasonalProfile,
  generateAlerts,
} from "./analytics";
import { DEFAULT_RISK_PARAMETERS } from "./parameters";

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
    hailZone?: HailZone;
    exposure?: number;
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
    hailZone: opts.hailZone,
    risk:
      opts.score != null || opts.eal != null || opts.utilisation != null
        ? {
            overallScore: opts.score ?? 0,
            perils,
            eal: opts.eal ?? 0,
            utilisation: opts.utilisation,
            exposureEur: opts.exposure ?? opts.eal ?? 0,
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

describe("generateAlerts", () => {
  it("raises high-hail-zone and high-eal alerts", () => {
    const ds = [
      make("1", { hailZone: 5, eal: 900 }),
      make("2", { hailZone: 2, eal: 100, lat: 53 }),
    ];
    const alerts = generateAlerts(ds);
    expect(
      alerts.some((a) => a.kind === "high-hail-zone" && a.dealershipId === "1"),
    ).toBe(true);
    expect(
      alerts.some((a) => a.kind === "high-hail-zone" && a.dealershipId === "2"),
    ).toBe(false);
    expect(
      alerts.some((a) => a.kind === "high-eal" && a.dealershipId === "1"),
    ).toBe(true);
  });

  it("uses the configured hail-zone threshold", () => {
    const ds = [make("1", { hailZone: 4, eal: 1 })];
    expect(generateAlerts(ds).map((a) => a.kind)).not.toContain(
      "high-hail-zone",
    );
    expect(
      generateAlerts(ds, { ...DEFAULT_RISK_PARAMETERS, alertHailZone: 4 }).map(
        (a) => a.kind,
      ),
    ).toContain("high-hail-zone");
  });

  it("warns on overcapacity, low boundary confidence and no detection", () => {
    const ds = [
      make("1", {
        hailZone: 1,
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
    expect(kinds.has("estimated-hail-zone")).toBe(false);
  });

  it("flags a hail zone that is only estimated from the score", () => {
    const alerts = generateAlerts([make("1", { score: 60 })]);
    const estimated = alerts.find((a) => a.kind === "estimated-hail-zone");
    expect(estimated?.level).toBe("warning");
    expect(estimated?.value).toBe(4);
  });

  it("raises one accumulation alert per accumulation above the threshold", () => {
    const parameters = {
      ...DEFAULT_RISK_PARAMETERS,
      accumulationRadiusKm: 10,
      accumulationReinsureThresholdEur: 1_000_000,
    };
    const ds = [
      make("a", { hailZone: 1, eal: 1, exposure: 400_000, lat: 51, lon: 10 }),
      make("b", {
        hailZone: 1,
        eal: 1,
        exposure: 700_000,
        lat: 51.01,
        lon: 10,
      }),
      // Far away and alone: no accumulation.
      make("c", { hailZone: 1, eal: 1, exposure: 5_000_000, lat: 53, lon: 13 }),
    ];
    const alerts = generateAlerts(ds, parameters).filter(
      (a) => a.kind === "accumulation",
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0].dealershipId).toBe("b"); // largest exposure anchors it
    expect(alerts[0].memberIds).toEqual(["a", "b"]);
    expect(alerts[0].value).toBe(1_100_000);
    expect(alertIdSet(alerts)).toEqual(new Set(["a", "b"]));

    const below = generateAlerts(ds, {
      ...parameters,
      accumulationReinsureThresholdEur: 2_000_000,
    });
    expect(below.some((a) => a.kind === "accumulation")).toBe(false);
  });

  it("lists critical alerts before warnings", () => {
    const ds = [make("1", { hailZone: 6, eal: 1, utilisation: 2 })];
    const levels = generateAlerts(ds).map((a) => a.level);
    expect(levels.indexOf("warning")).toBeGreaterThan(
      levels.lastIndexOf("critical"),
    );
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

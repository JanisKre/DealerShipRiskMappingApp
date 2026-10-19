import { describe, expect, it } from "vitest";
import type { AnalyzedDealership, PerilScore } from "./types";
import { PERILS, DashboardSpecSchema } from "./types";
import {
  buildDefaultDashboardSpec,
  computeDashboardData,
} from "./dashboard-aggregates";

/** Builds a minimal analyzed dataset (analogous to analytics.test.ts). */
function make(
  id: string,
  opts: {
    name?: string;
    score?: number;
    eal?: number;
    exposureEur?: number;
    vehicleCount?: number;
    perilScores?: Partial<Record<(typeof PERILS)[number], number>>;
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
    name: opts.name ?? `D-${id}`,
    lat: 51,
    lon: 10,
    risk:
      opts.score != null || opts.eal != null
        ? {
            overallScore: opts.score ?? 0,
            perils,
            eal: opts.eal ?? 0,
            exposureEur: opts.exposureEur ?? opts.eal ?? 0,
            computedAt: "2026-01-01T00:00:00.000Z",
          }
        : undefined,
    detection:
      opts.vehicleCount != null
        ? { vehicleCount: opts.vehicleCount, confidence: 0.9, model: "test" }
        : undefined,
  };
}

describe("computeDashboardData", () => {
  it("aggregates KPI totals across the portfolio", () => {
    const ds = [
      make("1", { score: 80, eal: 300, exposureEur: 1000, vehicleCount: 5 }),
      make("2", { score: 20, eal: 100, exposureEur: 500, vehicleCount: 3 }),
    ];
    const { kpi } = computeDashboardData(ds);
    expect(kpi.count).toBe(2);
    expect(kpi.totalEal).toBe(400);
    expect(kpi.totalExposure).toBe(1500);
    expect(kpi.totalVehicles).toBe(8);
    expect(kpi.elevatedZoneCount).toBe(1); // only zone >= 4 (score 80 -> zone 5)
  });

  it("counts locations per hail zone and drops empty zones", () => {
    const ds = [
      make("1", { score: 90 }), // zone 6
      make("2", { score: 60 }), // zone 4
      make("3", { score: 10 }), // zone 2
      make("4", { score: 12 }), // zone 2
    ];
    const { hailZoneDistribution } = computeDashboardData(ds);
    const byLabel = Object.fromEntries(
      hailZoneDistribution.map((p) => [p.label, p.value]),
    );
    expect(byLabel).toEqual({ "Zone 6": 1, "Zone 4": 1, "Zone 2": 2 });
    // "Zone 3" is empty => not included.
    expect(hailZoneDistribution.some((p) => p.label === "Zone 3")).toBe(false);
  });

  it("ranks topHailZone by zone, then by EAL", () => {
    const ds = [
      make("1", { name: "A", score: 60, eal: 100 }), // zone 4
      make("2", { name: "B", score: 60, eal: 500 }), // zone 4, larger EAL
      make("3", { name: "C", score: 90, eal: 10 }), // zone 6
    ];
    const { topHailZone } = computeDashboardData(ds);
    expect(topHailZone.map((p) => p.label)).toEqual(["C", "B", "A"]);
    expect(topHailZone.map((p) => p.value)).toEqual([6, 4, 4]);
  });

  it("orders topEal descending and caps at 10", () => {
    const ds = Array.from({ length: 15 }, (_, i) =>
      make(`d${i}`, { name: `D${i}`, eal: (i + 1) * 100 }),
    );
    const { topEal } = computeDashboardData(ds);
    expect(topEal).toHaveLength(10);
    expect(topEal[0].value).toBe(1500); // largest EAL first
    // sorted descending
    for (let i = 1; i < topEal.length; i++) {
      expect(topEal[i - 1].value).toBeGreaterThanOrEqual(topEal[i].value);
    }
  });

  it("always reports twelve hail seasonal months", () => {
    const ds = [make("1", { score: 50, perilScores: { hail: 80 } })];
    const data = computeDashboardData(ds);
    expect(data.seasonalProfile).toHaveLength(12);
    expect(Object.keys(data.seasonalProfile[0])).toEqual(["month", "hail"]);
  });

  it("stays finite for an empty portfolio", () => {
    const data = computeDashboardData([]);
    expect(data.kpi).toEqual({
      count: 0,
      totalEal: 0,
      totalExposure: 0,
      totalVehicles: 0,
      elevatedZoneCount: 0,
    });
    expect(data.hailZoneDistribution).toEqual([]);
    expect(data.topEal).toEqual([]);
  });
});

describe("DashboardSpec validation", () => {
  it("accepts a well-formed spec", () => {
    const valid = {
      title: "Test",
      widgets: [
        { id: "a", type: "kpi", title: "Locations", source: "kpi.count" },
      ],
    };
    expect(() => DashboardSpecSchema.parse(valid)).not.toThrow();
  });

  it("rejects an unknown widget type and an empty widget list", () => {
    expect(() =>
      DashboardSpecSchema.parse({
        title: "x",
        widgets: [{ id: "a", type: "wormhole", title: "?" }],
      }),
    ).toThrow();
    expect(() =>
      DashboardSpecSchema.parse({ title: "x", widgets: [] }),
    ).toThrow();
  });

  it("produces a fallback spec that validates against the schema", () => {
    expect(() =>
      DashboardSpecSchema.parse(buildDefaultDashboardSpec()),
    ).not.toThrow();
  });
});

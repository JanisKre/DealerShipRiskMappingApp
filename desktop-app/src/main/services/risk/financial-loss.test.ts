import { describe, expect, it } from "vitest";
import type {
  NatCatAssessment,
  PerilScore,
  VehicleTimeline,
} from "@shared/types";
import { PERILS } from "@shared/types";
import { computeEalBreakdown, resolveHailZone } from "./financial-loss";

function perils(hail: number): PerilScore[] {
  return PERILS.map((peril) => ({
    peril,
    score: hail,
    hazardValue: 0,
    unit: "x",
  }));
}

const DETECTION = { vehicleCount: 100, confidence: 0.9, model: "test" };

describe("resolveHailZone", () => {
  it("uses the postcode zone when no provider covers hail", () => {
    expect(resolveHailZone(perils(10), 4)).toEqual({
      zone: 4,
      source: "postcode",
    });
  });

  it("estimates the zone from the weather-based hail score without a postcode zone", () => {
    expect(resolveHailZone(perils(62))).toEqual({
      zone: 4,
      source: "estimated",
    });
  });

  it("lets a licensed provider's hail score win over the postcode zone", () => {
    const natCat = {
      hazards: [{ peril: "hail", score: 100 }],
    } as unknown as NatCatAssessment;
    expect(resolveHailZone(perils(100), 2, natCat)).toEqual({
      zone: 6,
      source: "provider",
    });
  });
});

describe("computeEalBreakdown", () => {
  it("is hail-only and keeps the formula inputs", () => {
    const eb = computeEalBreakdown(DETECTION, perils(0), 6);
    // 100 counted vehicles × λ6 0.15 × Σ p·S 2,080 = 31,200
    expect(eb.hail).toBe(31_200);
    expect(eb.total).toBe(31_200);
    expect(Object.keys(eb).sort()).toEqual(["hail", "hailDetail", "total"]);
    expect(eb.hailDetail).toEqual({
      vehicles: 100,
      exposedVehicles: 100,
      vehicleSource: "detected",
      zone: 6,
      zoneSource: "postcode",
      frequency: 0.15,
      meanSeverityEur: 2_080,
    });
  });

  it("never estimates a vehicle count from the asset value", () => {
    const eb = computeEalBreakdown(undefined, perils(0), 1);
    expect(eb.total).toBe(0);
    expect(eb.hailDetail?.vehicleSource).toBe("none");
  });
});

describe("stock range (hail EAL over archived images)", () => {
  const timeline = (...counts: number[]): VehicleTimeline => ({
    counts: counts.map((vehicleCount, i) => ({
      candidateId: `c${i}`,
      capturedAt: `202${i}-06-01`,
      resolutionM: 0.3,
      vehicleCount,
    })),
    median: [...counts].sort((a, b) => a - b)[Math.floor(counts.length / 2)],
    min: Math.min(...counts),
    max: Math.max(...counts),
    computedAt: "2026-11-14T00:00:00Z",
  });

  it("adds the EAL at the lowest, median and highest archived count; the point EAL stays", () => {
    const eb = computeEalBreakdown(
      { ...DETECTION, timeline: timeline(60, 100, 140) },
      perils(0),
      6,
    );
    expect(eb.hail).toBe(31_200);
    expect(eb.hailDetail?.stockRange).toEqual({
      images: 3,
      from: "2020-06-01",
      to: "2022-06-01",
      vehiclesLow: 60,
      vehiclesMedian: 100,
      vehiclesHigh: 140,
      ealLow: 18_720,
      ealMedian: 31_200,
      ealHigh: 43_680,
      scaledToManual: false,
      snapshot: "typical",
    });
  });

  it("flags an analysed image well above the archived median", () => {
    const eb = computeEalBreakdown(
      { ...DETECTION, timeline: timeline(50, 60, 70) },
      perils(0),
      6,
    );
    expect(eb.hailDetail?.stockRange?.snapshot).toBe("high");
  });

  it("scales the archived counts to a manually reviewed count", () => {
    // Detector saw 100, the underwriter counted 120: archived counts × 1.2.
    const eb = computeEalBreakdown(
      {
        ...DETECTION,
        manualVehicleCount: 120,
        timeline: timeline(50, 100),
      },
      perils(0),
      6,
    );
    const range = eb.hailDetail?.stockRange;
    expect(range?.scaledToManual).toBe(true);
    expect(range?.vehiclesLow).toBe(60);
    expect(range?.vehiclesHigh).toBe(120);
  });

  it("gives no range for one archived image or without a machine count", () => {
    expect(
      computeEalBreakdown(
        { ...DETECTION, timeline: timeline(90) },
        perils(0),
        6,
      ).hailDetail?.stockRange,
    ).toBeUndefined();
    expect(
      computeEalBreakdown(
        {
          ...DETECTION,
          vehicleCount: 0,
          manualVehicleCount: 30,
          timeline: timeline(10, 20),
        },
        perils(0),
        6,
      ).hailDetail?.stockRange,
    ).toBeUndefined();
  });
});

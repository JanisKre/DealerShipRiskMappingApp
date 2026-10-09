import { describe, expect, it } from "vitest";
import type { NatCatAssessment, PerilScore } from "@shared/types";
import { PERILS } from "@shared/types";
import { computeEalBreakdown, resolveHailZone } from "./financial-loss";

function perils(hail: number): PerilScore[] {
  return PERILS.map((peril) => ({
    peril,
    score: peril === "hail" ? hail : 50,
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
    const eb = computeEalBreakdown(DETECTION, 0, 0.5, perils(0), 6);
    // 100 vehicles × 0.5 open-air × λ6 0.15 × Σ p·S 2,080 = 15,600
    expect(eb.hail).toBe(15_600);
    expect(eb.total).toBe(15_600);
    expect(eb.wind).toBeUndefined();
    expect(eb.flood).toBeUndefined();
    expect(eb.hailDetail).toEqual({
      vehicles: 100,
      exposedVehicles: 50,
      vehicleSource: "detected",
      zone: 6,
      zoneSource: "postcode",
      frequency: 0.15,
      meanSeverityEur: 2_080,
    });
  });

  it("falls back to the asset value when nothing was counted", () => {
    const eb = computeEalBreakdown(undefined, 500_000, 1, perils(0), 1);
    // 500,000 / 25,000 = 20 vehicles × 0.01 × 2,080 = 416
    expect(eb.total).toBe(416);
    expect(eb.hailDetail?.vehicleSource).toBe("assetValue");
  });
});

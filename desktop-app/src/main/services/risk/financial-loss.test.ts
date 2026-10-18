import { describe, expect, it } from "vitest";
import type { NatCatAssessment, PerilScore } from "@shared/types";
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

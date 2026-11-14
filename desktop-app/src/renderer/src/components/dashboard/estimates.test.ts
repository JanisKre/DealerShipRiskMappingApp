import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "@shared/types";
import { AREA_ESTIMATE_DETECTOR } from "@shared/risk-math";
import {
  ealCoverage,
  ealSortValue,
  estimateReasons,
  estimatedExposure,
  hasEalBasis,
} from "./estimates";

function site(patch: Partial<AnalyzedDealership>): AnalyzedDealership {
  return {
    id: "1",
    name: "A",
    lat: 48,
    lon: 11,
    risk: { eal: 10, exposureEur: 100 } as AnalyzedDealership["risk"],
    detection: { vehicleCount: 10, confidence: 0.9, model: "yolo" },
    ...patch,
  } as AnalyzedDealership;
}

describe("estimateReasons", () => {
  it("is empty for a detected count on a real boundary", () => {
    expect(estimateReasons(site({}))).toEqual([]);
  });

  it("flags an area-based vehicle estimate", () => {
    expect(
      estimateReasons(
        site({
          detection: {
            vehicleCount: 2896,
            confidence: 0.3,
            model: AREA_ESTIMATE_DETECTOR,
          },
        }),
      ),
    ).toEqual(["vehicles"]);
  });

  it("flags a fallback circle as the lot", () => {
    expect(
      estimateReasons(
        site({
          boundary: { source: "synthetic" } as AnalyzedDealership["boundary"],
        }),
      ),
    ).toEqual(["boundary"]);
  });

  it("trusts a reviewed count and ignores unanalysed sites", () => {
    expect(
      estimateReasons(
        site({
          detection: {
            vehicleCount: 2896,
            manualVehicleCount: 40,
            confidence: 0.3,
            model: AREA_ESTIMATE_DETECTOR,
          },
          boundary: { source: "synthetic" } as AnalyzedDealership["boundary"],
        }),
      ),
    ).toEqual([]);
    expect(estimateReasons(site({ risk: undefined }))).toEqual([]);
  });
});

const areaEstimate = {
  vehicleCount: 2896,
  confidence: 0.3,
  model: AREA_ESTIMATE_DETECTOR,
};

describe("hasEalBasis", () => {
  it("is true for a model count and for a reviewed count", () => {
    expect(hasEalBasis(site({}))).toBe(true);
    expect(
      hasEalBasis(
        site({ detection: { ...areaEstimate, manualVehicleCount: 300 } }),
      ),
    ).toBe(true);
  });

  it("is false for an area estimate and for unanalysed sites", () => {
    expect(hasEalBasis(site({ detection: areaEstimate }))).toBe(false);
    expect(hasEalBasis(site({ risk: undefined }))).toBe(false);
  });

  it("follows the stored vehicle source of the EAL", () => {
    const risk = {
      eal: 0,
      exposureEur: 1,
      ealBreakdown: {
        hail: 0,
        total: 0,
        hailDetail: { vehicleSource: "none" },
      },
    } as unknown as AnalyzedDealership["risk"];
    expect(hasEalBasis(site({ risk }))).toBe(false);
  });
});

describe("ealCoverage", () => {
  it("counts analysed sites with a vehicle count", () => {
    expect(
      ealCoverage([
        site({}),
        site({ id: "2", detection: areaEstimate }),
        site({ id: "3", risk: undefined }),
      ]),
    ).toEqual({ withBasis: 1, analyzed: 2 });
  });
});

describe("estimatedExposure", () => {
  it("sums the exposure of estimated sites", () => {
    const result = estimatedExposure([
      site({
        risk: { eal: 0, exposureEur: 300 } as AnalyzedDealership["risk"],
      }),
      site({
        id: "2",
        detection: areaEstimate,
        risk: { eal: 0, exposureEur: 700 } as AnalyzedDealership["risk"],
      }),
    ]);
    expect(result).toEqual({ totalEur: 1000, estimatedEur: 700, share: 0.7 });
    expect(estimatedExposure([]).share).toBe(0);
  });
});

describe("ealSortValue", () => {
  it("ranks counted sites first, then uncounted by exposure, then pending", () => {
    const counted0 = site({
      id: "c0",
      detection: { ...areaEstimate, manualVehicleCount: 0 },
      risk: { eal: 0, exposureEur: 0 } as AnalyzedDealership["risk"],
    });
    const counted = site({ id: "c" });
    const bigNoCount = site({
      id: "big",
      detection: areaEstimate,
      risk: { eal: 0, exposureEur: 72_400_000 } as AnalyzedDealership["risk"],
    });
    const smallNoCount = site({
      id: "small",
      detection: areaEstimate,
      risk: { eal: 0, exposureEur: 1_000 } as AnalyzedDealership["risk"],
    });
    const pending = site({ id: "p", risk: undefined });
    const order = [pending, smallNoCount, bigNoCount, counted0, counted]
      .sort((a, b) => ealSortValue(b) - ealSortValue(a))
      .map((d) => d.id);
    expect(order).toEqual(["c", "c0", "big", "small", "p"]);
  });
});

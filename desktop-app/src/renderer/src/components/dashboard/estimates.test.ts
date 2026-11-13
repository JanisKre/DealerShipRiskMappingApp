import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "@shared/types";
import { AREA_ESTIMATE_DETECTOR } from "@shared/risk-math";
import { estimateReasons } from "./estimates";

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

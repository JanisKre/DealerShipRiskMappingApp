import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "@shared/types";
import { stockCountCandidates } from "./stockCount";

function site(
  id: string,
  eal: number,
  extra: Partial<NonNullable<AnalyzedDealership["detection"]>> = {},
): AnalyzedDealership {
  return {
    id,
    name: id,
    address: "",
    lat: 51,
    lon: 7,
    detection: { vehicleCount: 10, confidence: 0.8, model: "yolo", ...extra },
    risk: { eal } as AnalyzedDealership["risk"],
  } as AnalyzedDealership;
}

describe("stockCountCandidates", () => {
  it("takes the highest EAL first and skips counted and model-less sites", () => {
    const ids = stockCountCandidates(
      [
        site("low", 100),
        site("high", 900),
        site("counted", 800, {
          timeline: { counts: [], median: 0, min: 0, max: 0, computedAt: "" },
        }),
        site("area", 700, { model: "stub-area-heuristic" }),
        site("mid", 500),
      ],
      2,
    );
    expect(ids).toEqual(["high", "mid"]);
  });
});

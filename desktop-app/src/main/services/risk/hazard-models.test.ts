import { describe, expect, it } from "vitest";
import type { NatCatAssessment } from "@shared/types";
import { primaryHailScore, scorePerils } from "./hazard-models";

const WEATHER = { hailProbability: 0.1 };

function provider(score: number): NatCatAssessment {
  return {
    provider: "swissre-catnet",
    retrievedAt: "2026-01-01T00:00:00.000Z",
    hazards: [
      { peril: "hail", score, hazardValue: 3, unit: "CatNet hail zone" },
    ],
    attributes: {},
    evidence: {
      source: "Swiss Re CatNet",
      retrievedAt: "2026-01-01T00:00:00.000Z",
      method: "fixture",
      confidence: 1,
      fallbackUsed: false,
      limitations: [],
    },
  };
}

describe("primaryHailScore", () => {
  it("uses hail as the dealership primary score", () => {
    expect(
      primaryHailScore([
        { peril: "hail", score: 35, hazardValue: 35, unit: "test" },
      ]),
    ).toBe(35);
  });

  it("falls back to zero when hail is unavailable", () => {
    expect(primaryHailScore([])).toBe(0);
  });
});

describe("scorePerils", () => {
  it("scores hail only", () => {
    expect(scorePerils(WEATHER).map((s) => s.peril)).toEqual(["hail"]);
  });

  it("uses the postcode hail zone before the weather proxy", () => {
    expect(scorePerils(WEATHER, 4)[0]).toMatchObject({
      hazardValue: 4,
      unit: "K-Kasko zone",
    });
    expect(scorePerils(WEATHER)[0]).toMatchObject({
      score: 10,
      hazardValue: 10,
      unit: "%",
    });
  });

  it("uses a normalized licensed-provider hail score", () => {
    expect(scorePerils(WEATHER, 2, provider(80))[0]).toEqual({
      peril: "hail",
      score: 80,
      hazardValue: 3,
      unit: "CatNet hail zone",
    });
  });
});

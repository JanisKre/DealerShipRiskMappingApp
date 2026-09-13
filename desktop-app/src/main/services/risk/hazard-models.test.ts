import { describe, expect, it } from "vitest";
import type { PerilScore } from "@shared/types";
import { primaryHailScore, scorePerils } from "./hazard-models";

const peril = (name: PerilScore["peril"], score: number): PerilScore => ({
  peril: name,
  score,
  hazardValue: score,
  unit: "test",
});

describe("primaryHailScore", () => {
  it("uses hail as the dealership primary score", () => {
    expect(
      primaryHailScore([
        peril("wind", 95),
        peril("flood", 80),
        peril("hail", 35),
      ]),
    ).toBe(35);
  });

  it("falls back to zero when hail is unavailable", () => {
    expect(primaryHailScore([peril("wind", 95)])).toBe(0);
  });
});

describe("scorePerils provider overrides", () => {
  it("uses a normalized licensed-provider score for covered perils", () => {
    const scores = scorePerils(
      {
        maxWindKmh: 20,
        annualPrecipMm: 400,
        maxSnowDepthCm: 2,
        lightningDensity: 0.5,
        hailProbability: 0.1,
        maxTempC: 25,
        hotDays: 2,
      },
      undefined,
      undefined,
      {
        provider: "zuers-geo",
        retrievedAt: "2026-01-01T00:00:00.000Z",
        hazards: [
          {
            peril: "flood",
            score: 100,
            hazardValue: 4,
            unit: "ZÜRS class",
            rawValue: 4,
          },
        ],
        attributes: {},
        evidence: {
          source: "ZÜRS Geo",
          retrievedAt: "2026-01-01T00:00:00.000Z",
          method: "fixture",
          confidence: 1,
          fallbackUsed: false,
          limitations: [],
        },
      },
    );
    expect(scores.find((score) => score.peril === "flood")).toMatchObject({
      score: 100,
      hazardValue: 4,
      unit: "ZÜRS class",
    });
  });
});

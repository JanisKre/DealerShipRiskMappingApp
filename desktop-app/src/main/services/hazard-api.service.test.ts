import { describe, expect, it } from "vitest";
import type { NatCatAssessment } from "@shared/types";
import { normalizeHazardApiResponse } from "./hazard-api.service";

const normalizeCatNetResponse = (payload: unknown): NatCatAssessment =>
  normalizeHazardApiResponse(payload, "swissre-catnet");

describe("hazard API adapter (CatNet)", () => {
  it("normalizes a contracted lookup response and retains frequency data", () => {
    const result = normalizeCatNetResponse({
      dataVersion: "2026.1",
      spatialResolution: "site",
      hazards: [
        {
          peril: "flood",
          score: 72,
          hazardValue: 0.02,
          unit: "annual exceedance probability",
          annualExceedanceProbability: 0.02,
        },
      ],
    });

    expect(result).toMatchObject({
      provider: "swissre-catnet",
      dataVersion: "2026.1",
      hazards: [
        { peril: "flood", score: 72, annualExceedanceProbability: 0.02 },
      ],
    });
    expect(result.evidence.source).toBe("Swiss Re CatNet");
  });

  it("rejects a malformed provider response", () => {
    expect(() => normalizeCatNetResponse({ hazards: [] })).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import {
  boundaryNeedsReview,
  MAX_UNEXPLAINED_OUTSIDE_VEHICLES,
} from "./boundary-review";
import { DEFAULT_RISK_PARAMETERS } from "./parameters";
import type { BoundaryQuality, BoundaryResult } from "./types";

const SQUARE: BoundaryResult["polygon"] = {
  type: "Polygon",
  coordinates: [
    [
      [13.0, 52.0],
      [13.001, 52.0],
      [13.001, 52.001],
      [13.0, 52.001],
      [13.0, 52.0],
    ],
  ],
};

/** A result that passes every clause, so each case can fail exactly one. */
function cleanQuality(patch: Partial<BoundaryQuality> = {}): BoundaryQuality {
  return {
    geometryValid: true,
    pointRelation: "inside",
    sourceAgreement: 0.8,
    areaPlausibility: 0.9,
    boundaryFit: 1,
    top2Margin: 0.5,
    reasons: [],
    ...patch,
  };
}

function clean(patch: Partial<BoundaryResult> = {}): BoundaryResult {
  return {
    source: "osm",
    role: "operationalLot",
    polygon: SQUARE,
    areaSqm: 8_000,
    confidence: 0.9,
    quality: cleanQuality(),
    ...patch,
  };
}

describe("boundaryNeedsReview", () => {
  it("accepts a well-supported operational lot", () => {
    expect(boundaryNeedsReview(clean(), DEFAULT_RISK_PARAMETERS)).toBe(false);
  });

  const cases: Array<[string, BoundaryResult]> = [
    ["synthetic fallback", clean({ source: "synthetic" })],
    ["role is not an operational lot", clean({ role: "parcel" })],
    ["confidence below threshold", clean({ confidence: 0.5 })],
    [
      "top-2 margin too narrow",
      clean({ quality: cleanQuality({ top2Margin: 0.01 }) }),
    ],
    [
      "reference point outside the ring",
      clean({ quality: cleanQuality({ pointRelation: "outside" }) }),
    ],
    [
      "no corroborating source",
      clean({ quality: cleanQuality({ sourceAgreement: 0 }) }),
    ],
    [
      "implausible area",
      clean({ quality: cleanQuality({ areaPlausibility: 0.1 }) }),
    ],
    [
      "outline barely backed by physical edges",
      clean({ quality: cleanQuality({ barrierSupport: 0.05 }) }),
    ],
    [
      "growth truncated by the area cap",
      clean({ quality: cleanQuality({ stoppedBy: "areaCap" }) }),
    ],
    [
      "growth truncated by the radius cap",
      clean({ quality: cleanQuality({ stoppedBy: "radiusCap" }) }),
    ],
    [
      "a row of vehicles sits outside the ring",
      clean({
        quality: cleanQuality({
          vehiclesOutsideNearby: MAX_UNEXPLAINED_OUTSIDE_VEHICLES + 1,
        }),
      }),
    ],
  ];

  it.each(cases)("flags %s", (_label, boundary) => {
    expect(boundaryNeedsReview(boundary, DEFAULT_RISK_PARAMETERS)).toBe(true);
  });

  it("treats absent fusion signals as neutral, not as failures", () => {
    // A boundary from the legacy chain carries no barrierSupport/stoppedBy.
    // Reading a missing field as a failing one would flag every legacy result.
    const legacy = clean();
    expect(legacy.quality?.barrierSupport).toBeUndefined();
    expect(legacy.quality?.stoppedBy).toBeUndefined();
    expect(boundaryNeedsReview(legacy, DEFAULT_RISK_PARAMETERS)).toBe(false);
  });

  it("tolerates a boundary with no quality block at all", () => {
    const bare = clean({ quality: undefined });
    // Only the missing sourceAgreement/areaPlausibility should fire.
    expect(boundaryNeedsReview(bare, DEFAULT_RISK_PARAMETERS)).toBe(true);
    expect(() => boundaryNeedsReview(bare, DEFAULT_RISK_PARAMETERS)).not.toThrow();
  });

  it("honours a relaxed threshold from session parameters", () => {
    const weak = clean({ confidence: 0.5 });
    expect(boundaryNeedsReview(weak, DEFAULT_RISK_PARAMETERS)).toBe(true);
    expect(
      boundaryNeedsReview(weak, {
        ...DEFAULT_RISK_PARAMETERS,
        boundaryReviewConfidence: 0.4,
      }),
    ).toBe(false);
  });

  it("growth that exhausted its evidence is not a review trigger", () => {
    expect(
      boundaryNeedsReview(
        clean({ quality: cleanQuality({ stoppedBy: "exhausted" }) }),
        DEFAULT_RISK_PARAMETERS,
      ),
    ).toBe(false);
  });
});

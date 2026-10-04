import { describe, expect, it } from "vitest";
import type { BoundaryResult } from "@shared/types";
import { riskLimitations } from "./evidence";

const PARCEL: BoundaryResult = {
  source: "alkis",
  role: "parcel",
  polygon: {
    type: "Polygon",
    coordinates: [
      [
        [13.0, 52.0],
        [13.001, 52.0],
        [13.001, 52.001],
        [13.0, 52.0],
      ],
    ],
  },
  areaSqm: 8_000,
  confidence: 0.6,
  reviewRequired: true,
};

describe("riskLimitations boundary review", () => {
  it("flags an unreviewed parcel boundary", () => {
    const limitations = riskLimitations(PARCEL, undefined);
    expect(limitations).toContain(
      "Boundary requires review before underwriting use",
    );
    expect(limitations).toContain(
      "Boundary represents parcel, not a confirmed operational lot",
    );
  });

  it("records a user confirmation instead of the review warnings", () => {
    const limitations = riskLimitations(
      {
        ...PARCEL,
        reviewRequired: false,
        confirmedAt: "2026-10-04T10:00:00.000Z",
      },
      undefined,
    );
    expect(limitations).toContain(
      "Boundary confirmed by visual review on 2026-10-04, not a cadastral survey",
    );
    expect(limitations.join("\n")).not.toMatch(/requires review|parcel/);
  });
});

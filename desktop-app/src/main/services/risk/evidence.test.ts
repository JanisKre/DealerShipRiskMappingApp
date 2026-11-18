import { describe, expect, it } from "vitest";
import type { BoundaryResult } from "@shared/types";
import {
  HAIL_EAL_PLACEHOLDERS,
  HAIL_VEHICLES_FROM_ASSET_VALUE,
  HAIL_ZONE_ESTIMATED,
  HAIL_ZONE_REGIONAL,
  overallConfidence,
  riskEvidence,
  riskLimitations,
} from "./evidence";

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

describe("hail EAL provenance", () => {
  const detail = {
    vehicles: 10,
    exposedVehicles: 10,
    zone: 3 as const,
    frequency: 0.04,
    meanSeverityEur: 2_080,
  };

  it("always marks the hail EAL parameters as placeholders", () => {
    expect(riskLimitations(undefined, undefined)).toContain(
      HAIL_EAL_PLACEHOLDERS,
    );
  });

  it("flags an estimated hail zone and an asset-value vehicle count", () => {
    const limitations = riskLimitations(undefined, undefined, undefined, {
      ...detail,
      vehicleSource: "assetValue",
      zoneSource: "estimated",
    });
    expect(limitations).toContain(HAIL_ZONE_ESTIMATED);
    expect(limitations).toContain(HAIL_VEHICLES_FROM_ASSET_VALUE);
  });

  it("adds hail-zone evidence with lower confidence when the zone is estimated", () => {
    const postcode = riskEvidence(undefined, undefined, undefined, {
      ...detail,
      vehicleSource: "detected",
      zoneSource: "postcode",
    });
    const estimated = riskEvidence(undefined, undefined, undefined, {
      ...detail,
      vehicleSource: "detected",
      zoneSource: "estimated",
    });
    // Without hazard evidence only the hail-zone evidence is listed.
    expect(postcode[0]).toMatchObject({
      source: "Postcode hail zones",
      fallbackUsed: false,
      limitations: [HAIL_ZONE_REGIONAL],
    });
    expect(postcode[0].dataVersion).toBeTruthy();
    expect(estimated[0]).toMatchObject({ fallbackUsed: true });
    expect(estimated[0].confidence).toBeLessThan(postcode[0].confidence);
  });
});

describe("overallConfidence", () => {
  const item = (source: string, confidence: number) => ({
    source,
    retrievedAt: "2026-11-19T00:00:00Z",
    method: "m",
    confidence,
    fallbackUsed: false,
    limitations: [],
  });

  it("never exceeds the weakest link of the hail chain", () => {
    const evidence = [item("Open-Meteo", 0.3), item("ALKIS", 0.95)];
    expect(overallConfidence(evidence)).toBe(0.3);
  });

  it("is capped while the EAL parameters are placeholders", () => {
    expect(overallConfidence([item("Provider", 0.9)], "Provider")).toBe(0.6);
  });

  it("is zero without evidence", () => {
    expect(overallConfidence([])).toBe(0);
  });
});

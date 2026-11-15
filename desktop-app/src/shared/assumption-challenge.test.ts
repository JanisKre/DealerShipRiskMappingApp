import { describe, expect, it } from "vitest";
import type { AnalyzedDealership } from "./types";
import { DEFAULT_RISK_PARAMETERS } from "./parameters";
import {
  challengeAssumptions,
  challengeFacts,
  usesPlaceholderHailParameters,
} from "./assumption-challenge";

const NOW = new Date("2026-11-15T00:00:00Z");

function site(overrides: Partial<AnalyzedDealership> = {}): AnalyzedDealership {
  return {
    id: "a",
    name: "Autohaus A",
    lat: 48.1,
    lon: 11.5,
    detection: {
      vehicleCount: 120,
      confidence: 0.8,
      model: "yolo",
    },
    risk: {
      overallScore: 60,
      perils: [],
      eal: 5000,
      ealBreakdown: {
        hail: 5000,
        total: 5000,
        hailDetail: {
          vehicles: 120,
          exposedVehicles: 120,
          vehicleSource: "detected",
          zone: 4,
          zoneSource: "postcode",
          frequency: 0.1,
          meanSeverityEur: 400,
        },
      },
      computedAt: "2026-10-01T00:00:00Z",
    },
    ...overrides,
  };
}

const kinds = (d: AnalyzedDealership, p = DEFAULT_RISK_PARAMETERS): string[] =>
  challengeAssumptions(d, p, NOW).map((c) => c.kind);

describe("challengeAssumptions", () => {
  it("reports only the missing analysis for an unanalysed location", () => {
    expect(kinds(site({ risk: undefined }))).toEqual(["notAnalyzed"]);
  });

  it("lists the general caveats for a clean detected count", () => {
    expect(kinds(site())).toEqual([
      "placeholderParameters",
      "singleImage",
      "noProtectionConsidered",
    ]);
  });

  it("drops the placeholder point once the hail parameters are calibrated", () => {
    const calibrated = { ...DEFAULT_RISK_PARAMETERS, hailFrequencyZone4: 0.42 };
    expect(usesPlaceholderHailParameters(calibrated)).toBe(false);
    expect(kinds(site(), calibrated)).not.toContain("placeholderParameters");
  });

  it("puts a synthetic boundary and an old image ahead of the caveats", () => {
    const d = site({
      boundary: {
        source: "synthetic",
        polygon: {
          type: "Polygon",
          coordinates: [
            [
              [11.5, 48.1],
              [11.51, 48.1],
              [11.51, 48.11],
              [11.5, 48.1],
            ],
          ],
        },
        areaSqm: 1000,
        confidence: 0.2,
      },
      detection: {
        vehicleCount: 120,
        confidence: 0.3,
        model: "yolo",
        imagery: {
          chosen: { capturedAt: "2021-06-01" },
        } as NonNullable<AnalyzedDealership["detection"]>["imagery"],
      },
    });
    const result = challengeAssumptions(d, DEFAULT_RISK_PARAMETERS, NOW);
    expect(result[0]).toMatchObject({ kind: "syntheticBoundary", severity: 3 });
    expect(result.map((c) => c.kind)).toEqual(
      expect.arrayContaining(["staleImagery", "lowDetectionConfidence"]),
    );
    expect(result.find((c) => c.kind === "staleImagery")?.values).toEqual({
      year: "2021",
      age: 5,
    });
    // Sorted by weight.
    const weights = result.map((c) => c.severity);
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
  });

  it("says in which direction an untypical stock snapshot is off", () => {
    const d = site();
    d.risk!.ealBreakdown!.hailDetail!.stockRange = {
      images: 5,
      from: "2019-01-01",
      to: "2025-01-01",
      vehiclesLow: 60,
      vehiclesMedian: 80,
      vehiclesHigh: 120,
      ealLow: 1,
      ealMedian: 2,
      ealHigh: 3,
      scaledToManual: false,
      snapshot: "high",
    };
    const snapshot = challengeAssumptions(d, DEFAULT_RISK_PARAMETERS, NOW).find(
      (c) => c.kind === "stockSnapshot",
    );
    expect(snapshot?.effect).toBe("lower");
  });

  it("treats a reviewed count as settled for count-related points", () => {
    const d = site({
      detection: {
        vehicleCount: 120,
        manualVehicleCount: 90,
        confidence: 0.2,
        model: "yolo",
      },
    });
    d.risk!.ealBreakdown!.hailDetail!.vehicleSource = "manual";
    expect(kinds(d)).toEqual([
      "placeholderParameters",
      "noProtectionConsidered",
    ]);
  });

  it("writes facts without amounts", () => {
    const d = site({ risk: { ...site().risk!, eal: 98765 } });
    const facts = challengeFacts(
      d.name,
      challengeAssumptions(d, DEFAULT_RISK_PARAMETERS, NOW),
    );
    expect(facts).toContain("Autohaus A");
    expect(facts).not.toContain("98765");
    expect(facts).not.toMatch(/\{\w+\}/);
  });
});

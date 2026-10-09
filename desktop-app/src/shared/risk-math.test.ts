import { describe, expect, it } from "vitest";
import type { AnalyzedDealership, PerilScore } from "./types";
import { PERILS } from "./types";
import {
  accumulationVerdict,
  computeAccumulationClusters,
  computeHailEal,
  dealershipHailZone,
  estimateHailZoneFromScore,
  groupSummary,
  hailVehicleBasis,
  meanHailSeverityEur,
  nearbyInsured,
  productLimitBreach,
} from "./risk-math";
import { DEFAULT_RISK_PARAMETERS } from "./parameters";
import {
  ACCUMULATION_RADIUS_KM,
  ACCUMULATION_REINSURE_THRESHOLD_EUR,
} from "./constants";

/** Minimal analyzed dataset with the fields needed for the accumulation math. */
function make(
  id: string,
  opts: {
    lat?: number;
    lon?: number;
    insured?: boolean;
    exposureEur?: number;
    hail?: number;
    productLimitEur?: number;
    salesPartner?: string;
    group?: string;
  } = {},
): AnalyzedDealership {
  const perils: PerilScore[] = PERILS.map((peril) => ({
    peril,
    score: peril === "hail" ? (opts.hail ?? 0) : 0,
    hazardValue: 0,
    unit: "x",
  }));
  return {
    id,
    name: `D-${id}`,
    lat: opts.lat ?? 51,
    lon: opts.lon ?? 10,
    insured: opts.insured,
    salesPartner: opts.salesPartner,
    group: opts.group,
    productLimitEur: opts.productLimitEur,
    risk: {
      overallScore: 0,
      perils,
      eal: 0,
      exposureEur: opts.exposureEur ?? 0,
      computedAt: "2026-01-01T00:00:00.000Z",
    },
  };
}

describe("nearbyInsured", () => {
  it("returns only insured dealerships within the radius, sorted by distance", () => {
    const subject = make("s", { lat: 51, lon: 10 });
    const all = [
      subject,
      make("near-insured", { lat: 51.02, lon: 10, insured: true }),
      make("near-uninsured", { lat: 51.01, lon: 10, insured: false }),
      make("far-insured", { lat: 55, lon: 10, insured: true }),
    ];
    const result = nearbyInsured(subject, all, ACCUMULATION_RADIUS_KM);
    expect(result.map((r) => r.dealership.id)).toEqual(["near-insured"]);
    expect(result[0].distanceKm).toBeGreaterThan(0);
  });

  it("excludes the subject itself", () => {
    const subject = make("s", { insured: true });
    const result = nearbyInsured(subject, [subject], ACCUMULATION_RADIUS_KM);
    expect(result).toHaveLength(0);
  });
});

describe("accumulationVerdict", () => {
  it("recommends reinsurance and high pricing above the threshold", () => {
    const subject = make("s", {
      exposureEur: ACCUMULATION_REINSURE_THRESHOLD_EUR * 2,
    });
    const neighbors = nearbyInsured(subject, [subject], ACCUMULATION_RADIUS_KM);
    const v = accumulationVerdict(subject, neighbors, ACCUMULATION_RADIUS_KM);
    expect(v.reinsure).toBe(true);
    expect(v.pricingHint).toBe("high");
  });

  it("stays low and no-reinsure well below the threshold", () => {
    const subject = make("s", { exposureEur: 1_000_000 });
    const v = accumulationVerdict(subject, [], ACCUMULATION_RADIUS_KM);
    expect(v.reinsure).toBe(false);
    expect(v.pricingHint).toBe("low");
  });
});

describe("productLimitBreach", () => {
  it("reports 'none' when no limit is set", () => {
    expect(productLimitBreach(make("s", { exposureEur: 9e9 })).severity).toBe(
      "none",
    );
  });

  it("breaches when exposure reaches the limit", () => {
    const d = make("s", {
      exposureEur: 12_000_000,
      productLimitEur: 10_000_000,
    });
    expect(productLimitBreach(d).severity).toBe("breach");
  });

  it("warns when exposure approaches the limit (≥ 70 %)", () => {
    const d = make("s", {
      exposureEur: 8_000_000,
      productLimitEur: 10_000_000,
    });
    expect(productLimitBreach(d).severity).toBe("warning");
  });

  it("stays 'none' comfortably below the limit", () => {
    const d = make("s", {
      exposureEur: 3_000_000,
      productLimitEur: 10_000_000,
    });
    expect(productLimitBreach(d).severity).toBe("none");
  });
});

describe("groupSummary", () => {
  it("returns null when the subject has no group", () => {
    const subject = make("s", { exposureEur: 1_000_000 });
    expect(groupSummary(subject, [subject])).toBeNull();
  });

  it("aggregates all locations of the same group across any distance", () => {
    const subject = make("s", {
      group: "G",
      lat: 51,
      lon: 10,
      exposureEur: 1_000_000,
      insured: true,
    });
    const all = [
      subject,
      make("g2", {
        group: "G",
        lat: 48,
        lon: 11,
        exposureEur: 2_000_000,
        insured: true,
        hail: 40,
      }),
      make("g3", {
        group: "G",
        lat: 53,
        lon: 7,
        exposureEur: 3_000_000,
        insured: false,
        hail: 80,
      }),
      make("other", { group: "H", lat: 51, lon: 10, exposureEur: 9_000_000 }),
    ];
    const summary = groupSummary(subject, all);
    expect(summary?.group).toBe("G");
    expect(summary?.memberCount).toBe(3);
    expect(summary?.insuredCount).toBe(2);
    expect(summary?.totalExposureEur).toBe(6_000_000);
    expect(summary?.maxHailScore).toBe(80);
  });

  it("recommends reinsurance and high pricing when the group total exceeds the threshold", () => {
    const subject = make("s", {
      group: "G",
      exposureEur: ACCUMULATION_REINSURE_THRESHOLD_EUR,
    });
    const other = make("g2", {
      group: "G",
      lat: 40,
      lon: 5,
      exposureEur: ACCUMULATION_REINSURE_THRESHOLD_EUR,
    });
    const summary = groupSummary(subject, [subject, other]);
    expect(summary?.reinsure).toBe(true);
    expect(summary?.pricingHint).toBe("high");
  });

  it("counts members that breach their product limit", () => {
    const subject = make("s", {
      group: "G",
      exposureEur: 12_000_000,
      productLimitEur: 10_000_000,
    });
    const ok = make("g2", {
      group: "G",
      exposureEur: 1_000_000,
      productLimitEur: 10_000_000,
    });
    expect(groupSummary(subject, [subject, ok])?.productLimitBreaches).toBe(1);
  });
});

describe("computeAccumulationClusters", () => {
  it("groups nearby dealerships and separates distant ones", () => {
    const ds = [
      make("a", { lat: 51.0, lon: 10.0, exposureEur: 1_000_000 }),
      make("b", { lat: 51.01, lon: 10.0, exposureEur: 2_000_000 }),
      make("z", { lat: 48.0, lon: 11.0, exposureEur: 5_000_000 }),
    ];
    const clusters = computeAccumulationClusters(ds, ACCUMULATION_RADIUS_KM);
    const multi = clusters.filter((c) => c.count > 1);
    expect(multi).toHaveLength(1);
    expect(multi[0].memberIds).toEqual(["a", "b"]);
    expect(multi[0].totalExposureEur).toBe(3_000_000);
  });

  it("produces a stable clusterId for the same members", () => {
    const ds = [
      make("a", { lat: 51.0, lon: 10.0 }),
      make("b", { lat: 51.01, lon: 10.0 }),
    ];
    const first = computeAccumulationClusters(ds, ACCUMULATION_RADIUS_KM)[0];
    const second = computeAccumulationClusters(
      [ds[1], ds[0]],
      ACCUMULATION_RADIUS_KM,
    )[0];
    expect(first.clusterId).toBe(second.clusterId);
  });

  it("sorts clusters by nat-cat KPI descending", () => {
    const ds = [
      make("a", { lat: 51.0, lon: 10.0, exposureEur: 1_000_000 }),
      make("b", { lat: 51.01, lon: 10.0, exposureEur: 1_000_000 }),
      make("c", { lat: 48.0, lon: 11.0, exposureEur: 50_000_000 }),
      make("d", { lat: 48.01, lon: 11.0, exposureEur: 50_000_000 }),
    ];
    const clusters = computeAccumulationClusters(ds, ACCUMULATION_RADIUS_KM);
    expect(clusters[0].natCatKpiEur).toBeGreaterThanOrEqual(
      clusters[1].natCatKpiEur,
    );
  });
});

describe("hail EAL", () => {
  // Defaults: p = 0.6/0.3/0.1, S = 800/3,000/7,000 EUR → Σ p·S = 2,080 EUR.
  it("computes the mean severity per vehicle and event", () => {
    expect(meanHailSeverityEur()).toBeCloseTo(2_080, 6);
  });

  it("normalizes class shares that do not add up to 1", () => {
    const doubled = {
      ...DEFAULT_RISK_PARAMETERS,
      hailShareSmall: 1.2,
      hailShareMedium: 0.6,
      hailShareLarge: 0.2,
    };
    expect(meanHailSeverityEur(doubled)).toBeCloseTo(2_080, 6);
    expect(
      meanHailSeverityEur({
        ...DEFAULT_RISK_PARAMETERS,
        hailShareSmall: 0,
        hailShareMedium: 0,
        hailShareLarge: 0,
      }),
    ).toBe(0);
  });

  it.each([
    [1, 0.01, 2_080],
    [2, 0.02, 4_160],
    [3, 0.04, 8_320],
    [4, 0.07, 14_560],
    [5, 0.1, 20_800],
    [6, 0.15, 31_200],
  ] as const)(
    "EAL = N × λ_z × Σ p·S for zone %i (100 open-air vehicles)",
    (zone, frequency, eal) => {
      const result = computeHailEal({ vehicles: 100, exposureRatio: 1, zone });
      expect(result.frequency).toBe(frequency);
      expect(result.exposedVehicles).toBe(100);
      expect(result.eal).toBeCloseTo(eal, 6);
    },
  );

  it("only counts vehicles parked in the open", () => {
    const result = computeHailEal({
      vehicles: 100,
      exposureRatio: 0.25,
      zone: 6,
    });
    expect(result.exposedVehicles).toBe(25);
    expect(result.eal).toBeCloseTo(7_800, 6);
  });

  it("returns zero without vehicles", () => {
    expect(computeHailEal({ vehicles: 0, exposureRatio: 1, zone: 6 }).eal).toBe(
      0,
    );
  });

  it("uses edited parameters", () => {
    const result = computeHailEal(
      { vehicles: 10, exposureRatio: 1, zone: 3 },
      { ...DEFAULT_RISK_PARAMETERS, hailFrequencyZone3: 0.5 },
    );
    expect(result.eal).toBeCloseTo(10 * 0.5 * 2_080, 6);
  });

  it("estimates the hail zone as the inverse of the zone score", () => {
    expect([0, 20, 40, 60, 80, 100].map(estimateHailZoneFromScore)).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
    expect(estimateHailZoneFromScore(-5)).toBe(1);
    expect(estimateHailZoneFromScore(150)).toBe(6);
  });

  it("prefers a reviewed vehicle count, then detection, then asset value", () => {
    expect(
      hailVehicleBasis(
        { vehicleCount: 40, manualVehicleCount: 55, confidence: 1, model: "m" },
        0,
      ),
    ).toEqual({ vehicles: 55, source: "manual" });
    expect(
      hailVehicleBasis({ vehicleCount: 40, confidence: 1, model: "m" }, 0),
    ).toEqual({ vehicles: 40, source: "detected" });
    expect(hailVehicleBasis(undefined, 250_000)).toEqual({
      vehicles: 10,
      source: "assetValue",
    });
    expect(hailVehicleBasis(undefined, 0)).toEqual({
      vehicles: 0,
      source: "none",
    });
  });
});

describe("dealershipHailZone", () => {
  it("prefers the zone stored with the EAL, then the postcode zone", () => {
    const d = make("1");
    expect(dealershipHailZone({ ...d, hailZone: 3 })).toEqual({
      zone: 3,
      source: "postcode",
    });
    expect(
      dealershipHailZone({
        ...d,
        hailZone: 3,
        risk: {
          ...d.risk!,
          ealBreakdown: {
            hail: 1,
            total: 1,
            hailDetail: {
              vehicles: 1,
              exposedVehicles: 1,
              vehicleSource: "detected",
              zone: 5,
              zoneSource: "provider",
              frequency: 0.1,
              meanSeverityEur: 2_080,
            },
          },
        },
      }),
    ).toEqual({ zone: 5, source: "provider" });
  });

  it("estimates the zone for results scored before the hail EAL", () => {
    const d = make("1");
    expect(
      dealershipHailZone({ ...d, risk: { ...d.risk!, overallScore: 80 } }),
    ).toEqual({ zone: 5, source: "estimated" });
    expect(dealershipHailZone({ ...d, risk: undefined })).toBeNull();
  });
});

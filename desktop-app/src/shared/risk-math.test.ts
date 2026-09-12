import { describe, expect, it } from "vitest";
import type { AnalyzedDealership, PerilScore } from "./types";
import { PERILS } from "./types";
import {
  accumulationVerdict,
  computeAccumulationClusters,
  groupSummary,
  nearbyInsured,
  productLimitBreach,
} from "./risk-math";
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
    const d = make("s", { exposureEur: 12_000_000, productLimitEur: 10_000_000 });
    expect(productLimitBreach(d).severity).toBe("breach");
  });

  it("warns when exposure approaches the limit (≥ 70 %)", () => {
    const d = make("s", { exposureEur: 8_000_000, productLimitEur: 10_000_000 });
    expect(productLimitBreach(d).severity).toBe("warning");
  });

  it("stays 'none' comfortably below the limit", () => {
    const d = make("s", { exposureEur: 3_000_000, productLimitEur: 10_000_000 });
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

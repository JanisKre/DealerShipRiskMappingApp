import { describe, expect, it } from "vitest";
import type { AnalyzedDealership, HailZone, RiskParameters } from "./types";
import { DEFAULT_RISK_PARAMETERS, normalizeRiskParameters } from "./parameters";
import {
  capacityStatus,
  capacityUse,
  marginalAccumulation,
  zoneCapacities,
  zoneCapacityEur,
} from "./capacity";

/** A located, analysed site; 0.05° of latitude is about 5.6 km. */
function site(
  id: string,
  opts: {
    lat?: number;
    lon?: number;
    exposureEur?: number;
    insured?: boolean;
    hailZone?: HailZone;
  } = {},
): AnalyzedDealership {
  return {
    id,
    name: `D-${id}`,
    lat: opts.lat ?? 51,
    lon: opts.lon ?? 10,
    insured: opts.insured,
    hailZone: opts.hailZone,
    risk: {
      overallScore: 0,
      perils: [],
      eal: 0,
      exposureEur: opts.exposureEur ?? 0,
      computedAt: "2026-01-01T00:00:00.000Z",
    },
  } as AnalyzedDealership;
}

const params = (over: Partial<RiskParameters>): RiskParameters => ({
  ...DEFAULT_RISK_PARAMETERS,
  ...over,
});

describe("capacityStatus", () => {
  it("cuts at half and at full", () => {
    expect(capacityStatus(0)).toBe("free");
    expect(capacityStatus(0.499)).toBe("free");
    expect(capacityStatus(0.5)).toBe("partial");
    expect(capacityStatus(0.999)).toBe("partial");
    expect(capacityStatus(1)).toBe("exhausted");
    expect(capacityStatus(1.4)).toBe("exhausted");
  });
});

describe("capacityUse", () => {
  it("is null when no capacity is set", () => {
    expect(capacityUse([site("a", { exposureEur: 5 })], 0)).toBeNull();
    expect(capacityUse([site("a", { exposureEur: 5 })], -1)).toBeNull();
    expect(capacityUse([site("a", { exposureEur: 5 })], Number.NaN)).toBeNull();
  });

  it("splits existing and new business and counts both", () => {
    const use = capacityUse(
      [
        site("bound", { exposureEur: 30_000_000, insured: true }),
        site("new", { exposureEur: 10_000_000, insured: false }),
        site("unknown", { exposureEur: 5_000_000 }),
      ],
      50_000_000,
    );
    expect(use).toMatchObject({
      capacityEur: 50_000_000,
      boundEur: 30_000_000,
      prospectEur: 15_000_000,
      usedEur: 45_000_000,
      remainingEur: 5_000_000,
      status: "partial",
    });
    expect(use?.utilisation).toBeCloseTo(0.9);
  });

  it("reports an exceeded capacity as a negative remainder", () => {
    const use = capacityUse(
      [site("a", { exposureEur: 60_000_000 })],
      50_000_000,
    );
    expect(use?.remainingEur).toBe(-10_000_000);
    expect(use?.utilisation).toBeCloseTo(1.2);
    expect(use?.status).toBe("exhausted");
  });

  it("treats a site without a result as no exposure", () => {
    const pending = { ...site("p"), risk: undefined } as AnalyzedDealership;
    expect(capacityUse([pending], 1_000)?.usedEur).toBe(0);
  });
});

describe("zone capacities", () => {
  it("defaults to no capacity, also for parameters saved before the fields", () => {
    const {
      capacityZone1Eur: _1,
      capacityZone2Eur: _2,
      capacityZone3Eur: _3,
      capacityZone4Eur: _4,
      capacityZone5Eur: _5,
      capacityZone6Eur: _6,
      ...legacy
    } = DEFAULT_RISK_PARAMETERS;
    const loaded = normalizeRiskParameters(legacy);
    for (const zone of [1, 2, 3, 4, 5, 6] as const)
      expect(zoneCapacityEur(loaded, zone)).toBe(0);
  });

  it("returns all six zones with exposure, and use only where a capacity is set", () => {
    const rows = zoneCapacities(
      [
        site("a", { hailZone: 5, exposureEur: 40_000_000, insured: true }),
        site("b", { hailZone: 5, exposureEur: 20_000_000 }),
        site("c", { hailZone: 2, exposureEur: 7_000_000 }),
      ],
      params({ capacityZone5Eur: 100_000_000 }),
    );
    expect(rows.map((r) => r.zone)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(rows[1]).toMatchObject({ count: 1, exposureEur: 7_000_000 });
    expect(rows[1].use).toBeNull();
    expect(rows[4]).toMatchObject({ count: 2, exposureEur: 60_000_000 });
    expect(rows[4].use).toMatchObject({
      boundEur: 40_000_000,
      prospectEur: 20_000_000,
      remainingEur: 40_000_000,
      status: "partial",
    });
    expect(rows[0]).toMatchObject({ count: 0, exposureEur: 0, use: null });
  });
});

describe("marginalAccumulation", () => {
  const capacity = params({
    accumulationRadiusKm: 10,
    accumulationReinsureThresholdEur: 50_000_000,
  });

  it("measures what a site adds to its accumulation", () => {
    const subject = site("s", { lat: 51.05, exposureEur: 10_000_000 });
    const all = [
      subject,
      site("n1", { lat: 51, exposureEur: 20_000_000 }),
      site("n2", { lat: 51.02, exposureEur: 10_000_000 }),
      site("far", { lat: 53, exposureEur: 99_000_000 }),
    ];
    const m = marginalAccumulation(subject, all, capacity);
    expect(m).toMatchObject({
      count: 3,
      subjectEur: 10_000_000,
      withEur: 40_000_000,
      withoutEur: 30_000_000,
      addedEur: 10_000_000,
      joins: 1,
      remainingWithoutEur: 20_000_000,
      status: "partial",
    });
    expect(m?.utilisationWith).toBeCloseTo(0.8);
    expect(m?.utilisationWithout).toBeCloseTo(0.6);
    expect(m?.shareOfRemaining).toBeCloseTo(0.5);
  });

  it("counts the whole joined group when the site bridges two accumulations", () => {
    // n1 and n2 are 11 km apart; only the subject between them links them.
    const subject = site("s", { lat: 51.05, exposureEur: 5_000_000 });
    const all = [
      site("n1", { lat: 51, exposureEur: 20_000_000 }),
      subject,
      site("n2", { lat: 51.1, exposureEur: 12_000_000 }),
    ];
    const m = marginalAccumulation(subject, all, capacity);
    expect(m).toMatchObject({
      count: 3,
      withEur: 37_000_000,
      withoutEur: 20_000_000,
      addedEur: 17_000_000,
      joins: 2,
    });
  });

  it("stands alone without a neighbour in reach", () => {
    const subject = site("s", { exposureEur: 30_000_000 });
    const m = marginalAccumulation(
      subject,
      [subject, site("far", { lat: 53, exposureEur: 1 })],
      capacity,
    );
    expect(m).toMatchObject({
      count: 1,
      withEur: 30_000_000,
      withoutEur: 0,
      addedEur: 30_000_000,
      joins: 0,
    });
    expect(m?.shareOfRemaining).toBeCloseTo(0.6);
  });

  it("has no share of the remainder once the others exhaust the capacity", () => {
    const subject = site("s", { lat: 51.01, exposureEur: 5_000_000 });
    const m = marginalAccumulation(
      subject,
      [subject, site("big", { exposureEur: 70_000_000 })],
      capacity,
    );
    expect(m?.remainingWithoutEur).toBe(0);
    expect(m?.shareOfRemaining).toBeNull();
    expect(m?.status).toBe("exhausted");
  });

  it("is null without coordinates or without a capacity", () => {
    const noCoords = { ...site("s"), lat: Number.NaN } as AnalyzedDealership;
    expect(marginalAccumulation(noCoords, [noCoords], capacity)).toBeNull();
    const subject = site("s");
    expect(
      marginalAccumulation(
        subject,
        [subject],
        params({ accumulationReinsureThresholdEur: 0 }),
      ),
    ).toBeNull();
  });

  it("uses the subject passed in, not a stale copy in the list", () => {
    const subject = site("s", { exposureEur: 8_000_000 });
    const stale = site("s", { exposureEur: 1 });
    const m = marginalAccumulation(subject, [stale], capacity);
    expect(m?.subjectEur).toBe(8_000_000);
    expect(m?.withEur).toBe(8_000_000);
  });
});

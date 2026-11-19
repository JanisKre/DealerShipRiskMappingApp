import { describe, expect, it } from "vitest";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import {
  buildSiteGraph,
  siteIdentity,
  type ParcelEvidence,
} from "./site-graph";
import {
  growSite,
  mainReasons,
  memberProbability,
  SITE_FEATURES,
  SITE_MODEL,
  siteFeatures,
} from "./site-model";

/**
 * A plain neighbour: a trade plot of the site's size sharing one side with
 * it, the border open on the image, nothing else known about it.
 */
function evidence(overrides: Partial<ParcelEvidence> = {}): ParcelEvidence {
  return {
    areaSqm: 2000,
    areaRatio: 1,
    sharedM: 45,
    borderOfParcel: 0.25,
    openBorderM: 45,
    greenBorder: 0,
    sharedBuilding: false,
    ownBuilding: false,
    firstBuilding: false,
    vehicles: 0,
    density: 0,
    nearVehicles: 0,
    nearShare: 0,
    siteVehicles: 40,
    lotVehicles: 0,
    address: "none",
    landUse: { commercial: 1 },
    seenShare: 1,
    ...overrides,
  };
}

/** A yard full of the dealer's cars: 40 on 2,000 m², rows continuing. */
const YARD = {
  vehicles: 40,
  density: 20,
  nearVehicles: 30,
  nearShare: 0.75,
  lotVehicles: 40,
} as const;

describe("site model: shape", () => {
  it("has one weight per feature", () => {
    expect(siteFeatures(evidence())).toHaveLength(SITE_FEATURES.length);
    expect(SITE_MODEL.weights).toHaveLength(SITE_FEATURES.length);
    expect(SITE_FEATURES[0]).toBe("bias");
    expect(siteFeatures(evidence())[0]).toBe(1);
  });

  it("keeps every feature within 0 and 1", () => {
    const extreme = evidence({
      ...YARD,
      density: 500,
      lotVehicles: 900,
      openBorderM: 400,
      borderOfParcel: 1,
      greenBorder: 1,
      sharedBuilding: true,
      areaSqm: 50,
      landUse: { residential: 1 },
    });
    for (const value of siteFeatures(extreme)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it("joins below one half and reports doubts around that", () => {
    expect(SITE_MODEL.joinAt).toBeLessThan(0.5);
    expect(SITE_MODEL.doubtFrom).toBeLessThan(SITE_MODEL.joinAt);
    expect(SITE_MODEL.sureFrom).toBeGreaterThan(SITE_MODEL.joinAt);
  });
});

describe("site model: what speaks for and against a parcel", () => {
  const p = (overrides: Partial<ParcelEvidence> = {}): number =>
    memberProbability(evidence(overrides));

  it("leaves a plain neighbour out", () => {
    expect(p()).toBeLessThan(SITE_MODEL.doubtFrom);
  });

  it("takes a yard full of the dealer's rows", () => {
    expect(p(YARD)).toBeGreaterThan(SITE_MODEL.sureFrom);
  });

  it("takes a parcel under the same building", () => {
    expect(p({ sharedBuilding: true })).toBeGreaterThan(SITE_MODEL.joinAt);
    expect(p({ sharedBuilding: true })).toBeGreaterThan(p());
  });

  it("is moved the right way by each piece of evidence", () => {
    const yard = p(YARD);
    expect(p({ ...YARD, greenBorder: 1, openBorderM: 0 })).toBeLessThan(yard);
    expect(p({ ...YARD, address: "other" })).toBeLessThan(yard);
    expect(p({ ...YARD, address: "same" })).toBeGreaterThan(yard);
    expect(p({ ...YARD, ownBuilding: true })).toBeLessThan(yard);
    expect(p({ ...YARD, landUse: { residential: 1 } })).toBeLessThan(yard);
    expect(p({ ...YARD, landUse: { open: 1 } })).toBeLessThan(yard);
    expect(p({ ...YARD, landUse: null })).toBeLessThan(yard);
    expect(p({ ...YARD, lotVehicles: 0 })).toBeLessThan(yard);
    expect(p({ borderOfParcel: 0.8 })).toBeGreaterThan(p());
  });

  it("does not let a large plot join that merely touches the site", () => {
    // A car compound five times the site, along a tenth of its outline.
    const compound = {
      ...YARD,
      areaSqm: 10_000,
      areaRatio: 5,
      borderOfParcel: 0.08,
      nearShare: 0.1,
      lotVehicles: 0,
    };
    expect(p(compound)).toBeLessThan(p({ ...compound, borderOfParcel: 0.25 }));
    expect(p(compound)).toBeLessThan(0.5);
  });

  it("looks for the lot next door when the site so far shows none", () => {
    const behind = {
      vehicles: 20,
      density: 10,
      nearVehicles: 5,
      nearShare: 0.25,
    };
    expect(p({ ...behind, siteVehicles: 0 })).toBeGreaterThan(
      p({ ...behind, siteVehicles: 40 }),
    );
  });

  it("does not hold missing vehicles against a parcel the image does not show", () => {
    const unseen = siteFeatures(evidence({ ...YARD, seenShare: 0.2 }));
    const index = (name: (typeof SITE_FEATURES)[number]): number =>
      SITE_FEATURES.indexOf(name);
    expect(unseen[index("unseen")]).toBe(1);
    expect(unseen[index("density")]).toBe(0);
    expect(unseen[index("lot")]).toBe(0);
  });

  it("names what moved a decision", () => {
    const reasons = mainReasons(evidence({ ...YARD, address: "other" }));
    expect(reasons.length).toBeGreaterThan(0);
    expect(reasons.length).toBeLessThanOrEqual(3);
    expect(reasons.join(" ")).toMatch(/density \+|lot \+/);
    expect(mainReasons(evidence({ address: "other" })).join(" ")).toMatch(
      /addressOther −/,
    );
  });
});

describe("site model: growth", () => {
  const ANCHOR: LonLat = [13.4, 52.5];
  const at = (east: number, north: number): LonLat =>
    unprojectPoint([east, north], ANCHOR);
  const rect = (w: number, s: number, e: number, n: number): LonLat[] => {
    const ring = [at(w, s), at(e, s), at(e, n), at(w, n)];
    ring.push(ring[0]);
    return ring;
  };
  const cars = (w: number, s: number, e: number, n: number): LonLat[] => {
    const points: LonLat[] = [];
    for (let x = w + 2.5; x < e; x += 5) {
      for (let y = s + 2.5; y < n; y += 5) points.push(at(x, y));
    }
    return points;
  };
  const parcel = (ring: LonLat[]): ParcelFeature => ({
    ring,
    areaSqm: ringAreaSqm(ring),
    state: "Sachsen",
    landUse: { commercial: 1 },
  });
  // Five 40 × 40 m plots in a row, the first at the point; cars on the
  // first four.
  const row = [0, 1, 2, 3, 4].map((i) =>
    parcel(rect(-20 + 40 * i, -20, 20 + 40 * i, 20)),
  );
  const graph = buildSiteGraph({
    anchor: ANCHOR,
    parcels: row,
    vehicles: cars(-20, -20, 140, 20),
    buildings: [],
    vegetationAt: () => false,
  });
  const site = siteIdentity(graph, 0);

  it("grows parcel by parcel as far as the evidence goes", () => {
    const growth = growSite(graph, 0, site, {
      excluded: () => false,
      maxAreaSqm: 60_000,
    });
    expect(growth.members).toEqual([0, 1, 2, 3]);
    expect(growth.joined.map((d) => d.parcel)).toEqual([1, 2, 3]);
    expect(growth.rejected.map((d) => d.parcel)).toEqual([4]);
    expect(growth.capped).toBe(false);
    expect(growth.areaSqm).toBeCloseTo(4 * 1600, -2);
  });

  it("never takes an excluded parcel, and nothing behind it", () => {
    const growth = growSite(graph, 0, site, {
      excluded: (index) => index === 2,
      maxAreaSqm: 60_000,
    });
    expect(growth.members).toEqual([0, 1]);
    expect(growth.rejected).toEqual([]);
  });

  it("stops at the area limit and says so", () => {
    const growth = growSite(graph, 0, site, {
      excluded: () => false,
      maxAreaSqm: 3_500,
    });
    expect(growth.members).toEqual([0, 1]);
    expect(growth.capped).toBe(true);
  });

  it("takes fewer parcels at a higher bar", () => {
    const strict = growSite(graph, 0, site, {
      excluded: () => false,
      maxAreaSqm: 60_000,
      joinAt: 0.999,
    });
    expect(strict.members).toEqual([0]);
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature, ParcelLandUse } from "../alkis.service";
import {
  POINT_SITE_LIMITS,
  pointSiteCheck,
  runCascade,
  type CascadeInput,
} from "./cascade";

/**
 * Cascade v11 (docs/boundary-model.md, "Cascade v11"): a point in woodland
 * or open land, with no building and no vehicles near it, is off the site.
 * Mirrors a real case: a directory entry without a street placed in a
 * forest, where the engine used to draw a 160 m circle into the trees.
 */

const ANCHOR: LonLat = [8.72, 50.58];

function at(east: number, north: number): LonLat {
  return unprojectPoint([east, north], ANCHOR);
}

function rect(
  west: number,
  south: number,
  east: number,
  north: number,
): LonLat[] {
  const points = [
    at(west, south),
    at(east, south),
    at(east, north),
    at(west, north),
  ];
  points.push(points[0]);
  return points;
}

function cars(
  west: number,
  south: number,
  east: number,
  north: number,
  step = 5,
): LonLat[] {
  const points: LonLat[] = [];
  for (let x = west + step / 2; x < east; x += step) {
    for (let y = south + step / 2; y < north; y += step) points.push(at(x, y));
  }
  return points;
}

function parcel(points: LonLat[], landUse?: ParcelLandUse): ParcelFeature {
  return {
    ring: points,
    areaSqm: ringAreaSqm(points),
    state: "Hessen",
    ...(landUse ? { landUse } : {}),
  };
}

const allGreen = (): boolean => true;
const noGreen = (): boolean => false;

function input(overrides: Partial<CascadeInput>): CascadeInput {
  return {
    anchor: ANCHOR,
    vehicles: [],
    osm: null,
    parcels: [],
    parameters: DEFAULT_RISK_PARAMETERS,
    ...overrides,
  };
}

describe("pointSiteCheck", () => {
  it("calls a point in a wood with nothing near it off the site", () => {
    expect(pointSiteCheck(input({ vegetationAt: allGreen }))?.offSite).toBe(
      true,
    );
  });

  it("keeps a point next to a building, however green the ground", () => {
    const check = pointSiteCheck(
      input({ vegetationAt: allGreen, buildings: [rect(30, -10, 60, 10)] }),
    );
    expect(check?.offSite).toBe(false);
  });

  it("keeps a point with vehicles around it", () => {
    const check = pointSiteCheck(
      input({ vegetationAt: allGreen, vehicles: cars(-10, -10, 10, 10) }),
    );
    expect(check?.offSite).toBe(false);
  });

  it("uses the cadastre's open-land share without an image", () => {
    const field = parcel(rect(-200, -200, 200, 200), { open: 0.95 });
    expect(pointSiteCheck(input({ parcels: [field] }))?.offSite).toBe(true);
    const estate = parcel(rect(-200, -200, 200, 200), { commercial: 1 });
    expect(pointSiteCheck(input({ parcels: [estate] }))?.offSite).toBe(false);
  });

  it("says nothing without an image or land use", () => {
    expect(pointSiteCheck(input({}))).toBeNull();
  });

  it("does not call a paved yard off the site", () => {
    expect(pointSiteCheck(input({ vegetationAt: noGreen }))?.offSite).toBe(
      false,
    );
  });
});

describe("runCascade with a point off the site", () => {
  it("returns no result and flags the point when no lot is near", () => {
    const outcome = runCascade(input({ vegetationAt: allGreen }));
    expect(outcome.result).toBeNull();
    expect(outcome.pointOffSite).toBe(true);
    expect(outcome.flags).toContain("pointOffSite");
  });

  it("drops the woodland parcel stage 4 would have returned", () => {
    const wood = parcel(rect(-60, -60, 60, 60), { open: 1 });
    const outcome = runCascade(input({ parcels: [wood] }));
    expect(outcome.result).toBeNull();
    expect(outcome.flags).toContain("pointOffSite");
    expect(outcome.alternatives.some((a) => a.areaSqm === wood.areaSqm)).toBe(
      true,
    );
  });

  it("uses the nearest vehicle lot within reach, at low confidence", () => {
    // A 40 × 40 m yard of 64 cars 120 m east of the point, in a clearing.
    const lot = cars(110, -20, 150, 20);
    const outcome = runCascade(
      input({
        vehicles: lot,
        vegetationAt: ([lon]) => lon < at(100, 0)[0],
      }),
    );
    expect(outcome.pointOffSite).toBe(true);
    expect(outcome.result).not.toBeNull();
    expect(outcome.result!.confidence).toBeLessThanOrEqual(
      POINT_SITE_LIMITS.movedConfidence,
    );
    expect(outcome.trace.join(" ")).toMatch(/nearest vehicle lot \d+ m away/);
  });

  it("ignores a lot beyond reach", () => {
    const far = POINT_SITE_LIMITS.nearestLotM + 50;
    const outcome = runCascade(
      input({
        vehicles: cars(far, -20, far + 40, 20),
        vegetationAt: ([lon]) => lon < at(far - 10, 0)[0],
      }),
    );
    expect(outcome.result).toBeNull();
    expect(outcome.pointOffSite).toBe(true);
  });

  it("leaves an ordinary parcel result alone", () => {
    const yard = parcel(rect(-40, -40, 40, 40), { commercial: 1 });
    const outcome = runCascade(
      input({
        parcels: [yard],
        vegetationAt: noGreen,
        buildings: [rect(-10, -10, 10, 10)],
      }),
    );
    expect(outcome.stage).toBe(4);
    expect(outcome.pointOffSite).toBeUndefined();
  });
});

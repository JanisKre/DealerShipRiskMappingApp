import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { geometryAreaSqm } from "@shared/boundary-geometry-utils";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import {
  CASCADE_LIMITS,
  cutBuildings,
  siteStage,
  ringShareInside,
  vehicleHullStage,
  withWholeBuildings,
  type CascadeInput,
} from "./cascade";

/**
 * Cascade v14 (docs/boundary-model.md, "Cascade v14"): a building is not
 * divided by the result's outline. Modelled on the two Sachsen-Anhalt
 * fixtures, where the dealer's showroom stands across the line between the
 * chosen parcel and a neighbouring one of about 24,000 m² that does not
 * join.
 */

const ANCHOR: LonLat = [11.62, 52.13];

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

/** Areas agree to 1 %: the two area formulas in use differ by a few m². */
function expectArea(actual: number, expected: number): void {
  expect(actual / expected).toBeCloseTo(1, 2);
}

function parcel(points: LonLat[]): ParcelFeature {
  return {
    ring: points,
    areaSqm: ringAreaSqm(points),
    state: "Sachsen-Anhalt",
  };
}

/** The dealer's plot, 80 × 60 m around the point. */
const yard = parcel(rect(-40, -30, 40, 30));
/** The plot east of it: large, no vehicles of the lot, does not join. */
const neighbour = parcel(rect(40, -100, 200, 100));
/** Vehicles on the western half of the yard. */
const stock = cars(-38, -28, 0, 28);

function input(
  buildings: LonLat[][],
  extra: Partial<CascadeInput> = {},
): CascadeInput {
  return {
    anchor: ANCHOR,
    vehicles: stock,
    osm: null,
    parcels: [yard, neighbour],
    buildings,
    parameters: DEFAULT_RISK_PARAMETERS,
    ...extra,
  };
}

describe("ringShareInside", () => {
  const geometry = {
    type: "Polygon" as const,
    coordinates: [rect(0, 0, 100, 100)],
  };

  it("measures how much of a ring lies inside a geometry", () => {
    expect(ringShareInside(rect(10, 10, 30, 30), geometry)).toBe(1);
    expect(ringShareInside(rect(200, 0, 220, 20), geometry)).toBe(0);
    expect(ringShareInside(rect(80, 10, 120, 50), geometry)).toBeCloseTo(
      0.5,
      1,
    );
    expect(ringShareInside(rect(90, 10, 130, 50), geometry)).toBeCloseTo(
      0.25,
      1,
    );
  });
});

describe("withWholeBuildings", () => {
  const geometry = {
    type: "Polygon" as const,
    coordinates: [rect(0, 0, 100, 100)],
  };
  const options = {
    minShare: 0.5,
    minBuildingSqm: 25,
    maxBuildingSqm: 20_000,
    maxAreaSqm: 60_000,
  };

  it("adds a footprint that lies mostly inside, along its own outline", () => {
    const building = rect(70, 20, 120, 60);
    const whole = withWholeBuildings(geometry, [building], options);
    expect(whole.added).toBe(1);
    expectArea(geometryAreaSqm(whole.geometry), 10_000 + 20 * 40);
    expect(cutBuildings(whole.geometry, [building])).toHaveLength(0);
  });

  it("leaves a footprint that lies mostly outside", () => {
    const building = rect(90, 20, 140, 60);
    const whole = withWholeBuildings(geometry, [building], options);
    expect(whole.added).toBe(0);
    expect(whole.geometry).toBe(geometry);
  });

  it("adds the building at the point whatever its share", () => {
    const building = rect(90, 20, 140, 60);
    const whole = withWholeBuildings(geometry, [building], {
      ...options,
      always: building,
    });
    expect(whole.added).toBe(1);
  });

  it("ignores sheds, very large halls and buildings already inside", () => {
    const shed = rect(98, 0, 102, 4);
    const hall = rect(50, -200, 250, 0.5 * 100);
    const inside = rect(10, 10, 30, 30);
    const whole = withWholeBuildings(geometry, [shed, hall, inside], options);
    expect(whole.added).toBe(0);
  });

  it("adds nothing when the result would exceed the largest allowed area", () => {
    const building = rect(70, 20, 120, 60);
    const whole = withWholeBuildings(geometry, [building], {
      ...options,
      maxAreaSqm: 10_200,
    });
    expect(whole.added).toBe(0);
  });
});

describe("stage 1 keeps buildings whole (v14)", () => {
  it("takes a showroom across the parcel line whole, not the neighbour's plot", () => {
    // 30 m of the showroom on the yard, 20 m on the neighbouring plot.
    const showroom = rect(10, -20, 60, 20);
    const outcome = siteStage(input([showroom]));
    const result = outcome.result!;
    expect(outcome.reason).toContain(
      "1 building(s) across the parcel line kept whole",
    );
    expectArea(result.areaSqm, yard.areaSqm + 20 * 40);
    expect(cutBuildings(result.polygon, [showroom])).toHaveLength(0);
    // The neighbouring plot itself stays out.
    expect(result.areaSqm).toBeLessThan(yard.areaSqm + 1000);
  });

  it("leaves the outline on the parcels when no building crosses them", () => {
    const showroom = rect(0, -20, 30, 20);
    const outcome = siteStage(input([showroom]));
    expect(outcome.reason).not.toContain("kept whole");
    expectArea(outcome.result!.areaSqm, yard.areaSqm);
  });

  it("does not take a neighbour's hall that reaches a little into the yard", () => {
    // 5 m on the yard, 45 m beyond it.
    const hall = rect(35, -20, 85, 20);
    const outcome = siteStage(input([hall]));
    expect(outcome.reason).not.toContain("kept whole");
    expectArea(outcome.result!.areaSqm, yard.areaSqm);
  });

  it("takes the building at the point whole even with its smaller part on the yard", () => {
    // The point lies in a building of which 40 m are on the yard's
    // neighbour: 0…40 of 100 m on the yard.
    const showroom = rect(-5, -10, 95, 10);
    const outcome = siteStage(input([showroom]));
    expect(outcome.reason).toContain("kept whole");
    expect(cutBuildings(outcome.result!.polygon, [showroom])).toHaveLength(0);
  });
});

describe("stage 4 keeps buildings whole (v14)", () => {
  it("returns the parcel at the point with the showroom across its line", () => {
    const showroom = rect(10, -20, 60, 20);
    const outcome = siteStage(input([showroom], { vehicles: null }));
    expect(outcome.reason).toContain("kept whole");
    expectArea(outcome.result!.areaSqm, yard.areaSqm + 20 * 40);
  });

  it("returns the bare parcel without buildings", () => {
    const outcome = siteStage(input([], { vehicles: null }));
    expect(outcome.reason).toMatch(/^parcel at the point, \d+ m²$/);
    expectArea(outcome.result!.areaSqm, yard.areaSqm);
  });
});

describe("stage 2 takes a building whole or not at all (v14)", () => {
  // No cadastre: the outline of the vehicles decides.
  const rows = cars(-60, -30, 0, 30);

  it("stops at the wall of a hall it would only clip", () => {
    // 10 m east of the last row: the outline's margin reaches a few metres
    // into it.
    const hall = rect(8, -30, 68, 30);
    const outcome = vehicleHullStage({
      anchor: at(-30, 0),
      vehicles: rows,
      osm: null,
      parcels: [],
      buildings: [hall],
      parameters: DEFAULT_RISK_PARAMETERS,
    });
    const result = outcome.result!;
    expect(ringShareInside(hall, result.polygon)).toBeLessThan(0.05);
    expect(cutBuildings(result.polygon, [hall])).toHaveLength(0);
  });

  it("takes a building the outline covers for the most part", () => {
    // A workshop 16 m deep right behind the rows: the 10 m margin covers
    // more than half of it.
    const workshop = rect(1, -20, 17, 20);
    const outcome = vehicleHullStage({
      anchor: at(-30, 0),
      vehicles: rows,
      osm: null,
      parcels: [],
      buildings: [workshop],
      parameters: DEFAULT_RISK_PARAMETERS,
    });
    const result = outcome.result!;
    expect(ringShareInside(workshop, result.polygon)).toBeGreaterThan(0.9);
    expect(cutBuildings(result.polygon, [workshop])).toHaveLength(0);
  });
});

describe("v14 limits", () => {
  it("counts a building as the lot's from half its footprint", () => {
    expect(CASCADE_LIMITS.wholeBuildingShare).toBe(0.5);
    expect(CASCADE_LIMITS.wholeBuildingMinSqm).toBe(25);
  });
});

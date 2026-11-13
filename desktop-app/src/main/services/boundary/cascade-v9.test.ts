import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { geometryAreaSqm } from "@shared/boundary-geometry-utils";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature, ParcelLandUse } from "../alkis.service";
import {
  addressAnchor,
  greenShare,
  isStreetLike,
  isStreetParcel,
  runCascade,
  streetByUse,
  trimVegetation,
  vehicleParcelStage,
  type CascadeInput,
} from "./cascade";

/**
 * Cascade v9 rules (docs/boundary-model.md, "Cascade v9"): what the
 * cadastre publishes with a parcel (address, land use) and what the aerial
 * image shows on it (vegetation) decide which parcels join.
 */

const ANCHOR: LonLat = [7.0, 51.0];

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

/** Vehicles every `step` metres filling the rectangle. */
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

function parcel(
  points: LonLat[],
  extra: { address?: string; landUse?: ParcelLandUse } = {},
): ParcelFeature {
  return { ring: points, areaSqm: ringAreaSqm(points), state: "NRW", ...extra };
}

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

/** Vegetation east of `fromEast` metres, known everywhere. */
function greenEastOf(fromEast: number) {
  const limit = at(fromEast, 0)[0];
  return ([lon]: LonLat): boolean | null => lon > limit;
}

const commercial: ParcelLandUse = { commercial: 1 };

/** Areas agree within one per cent (ring and geometry area differ slightly). */
function expectArea(actual: number | undefined, expected: number): void {
  expect(actual).toBeDefined();
  expect(Math.abs(actual! - expected)).toBeLessThan(0.01 * expected);
}

describe("streets by land use (v9)", () => {
  it("does not call a small yard plot a street when the cadastre registers trade", () => {
    const plot = rect(0, 0, 15, 15);
    expect(isStreetLike(plot)).toBe(true);
    expect(isStreetParcel(parcel(plot, { landUse: commercial }))).toBe(false);
  });

  it("calls a compact parcel a street when most of it is traffic area", () => {
    const square = parcel(rect(0, 0, 60, 60), {
      address: "Hauptstraße",
      landUse: { traffic: 0.8, other: 0.2 },
    });
    expect(isStreetLike(square.ring)).toBe(false);
    expect(streetByUse(square)).toBe(true);
  });

  it("keeps a plot with a house number although it is registered as a path", () => {
    const yard = parcel(rect(0, 0, 80, 80), {
      address: "Zu den Norderstücken 2",
      landUse: { traffic: 1 },
    });
    expect(streetByUse(yard)).toBe(false);
  });

  it("falls back to the shape where no land use is published", () => {
    expect(streetByUse(parcel(rect(0, 0, 15, 15)))).toBeNull();
    expect(isStreetParcel(parcel(rect(0, 0, 15, 15)))).toBe(true);
  });

  it("never joins a road, however many cars stand on it", () => {
    const yard = parcel(rect(-30, -30, 30, 30), { landUse: commercial });
    const road = parcel(rect(30, -30, 55, 30), {
      address: "Hauptstraße",
      landUse: { traffic: 1 },
    });
    const outcome = vehicleParcelStage(
      input({
        parcels: [yard, road],
        vehicles: [...cars(-25, -25, 25, 25), ...cars(31, -29, 54, 29)],
      }),
    );
    expectArea(outcome.result?.areaSqm, yard.areaSqm);
  });

  it("joins a small plot full of cars as a normal parcel, not as a leaf strip", () => {
    const yard = parcel(rect(-30, -30, 30, 30), { landUse: commercial });
    const small = parcel(rect(30, -8, 45, 8), { landUse: commercial });
    const beyond = parcel(rect(45, -8, 100, 8), { landUse: commercial });
    const outcome = vehicleParcelStage(
      input({
        parcels: [yard, small, beyond],
        vehicles: [
          ...cars(-25, -25, 25, 25),
          ...cars(31, -7, 44, 7),
          ...cars(46, -7, 99, 7),
        ],
      }),
    );
    // The lot grows on through the small plot.
    expect(outcome.result?.areaSqm).toBeGreaterThan(
      yard.areaSqm + small.areaSqm + 0.9 * beyond.areaSqm,
    );
  });
});

describe("parcels with the same address (v9)", () => {
  const yard = parcel(rect(-30, -30, 30, 30), {
    address: "Schmiedstraße 12",
    landUse: commercial,
  });
  const empty = rect(30, -30, 70, 30);

  it("joins a neighbouring parcel with the address of the parcel at the point", () => {
    const outcome = vehicleParcelStage(
      input({
        parcels: [
          yard,
          parcel(empty, { address: "Schmiedstraße 12", landUse: commercial }),
        ],
        vehicles: cars(-25, -25, 25, 25),
      }),
    );
    expectArea(outcome.result?.areaSqm, yard.areaSqm + ringAreaSqm(empty));
    expect(outcome.reason).toContain("1 by address");
  });

  it("does not join a neighbour with another address and no cars", () => {
    const outcome = vehicleParcelStage(
      input({
        parcels: [
          yard,
          parcel(empty, { address: "Schmiedstraße 14", landUse: commercial }),
        ],
        vehicles: cars(-25, -25, 25, 25),
      }),
    );
    expectArea(outcome.result?.areaSqm, yard.areaSqm);
  });

  it("joins a neighbour carrying the dealership's address", () => {
    const outcome = vehicleParcelStage(
      input({
        address: "Schmiedstr. 14, 52152 Simmerath",
        parcels: [
          yard,
          parcel(empty, { address: "Schmiedstraße 14", landUse: commercial }),
        ],
        vehicles: cars(-25, -25, 25, 25),
      }),
    );
    expect(outcome.result?.areaSqm).toBeGreaterThan(yard.areaSqm + 2000);
  });

  it("leaves a meadow with the same address out", () => {
    const outcome = vehicleParcelStage(
      input({
        parcels: [
          yard,
          parcel(empty, { address: "Schmiedstraße 12", landUse: commercial }),
        ],
        vehicles: cars(-25, -25, 25, 25),
        vegetationAt: greenEastOf(30),
      }),
    );
    expectArea(outcome.result?.areaSqm, yard.areaSqm);
  });
});

describe("housing and open land (v9)", () => {
  const yard = parcel(rect(-30, -30, 30, 30), { landUse: commercial });
  // Ten cars at the western edge of a large parcel: 10 per 3,000 m².
  const edgeCars = cars(31, -25, 36, 25);
  const neighbour = rect(30, -30, 80, 30);

  it("joins a trade parcel with ten cars at its edge", () => {
    const outcome = vehicleParcelStage(
      input({
        parcels: [yard, parcel(neighbour, { landUse: commercial })],
        vehicles: [...cars(-25, -25, 25, 25), ...edgeCars],
      }),
    );
    expect(outcome.result?.areaSqm).toBeGreaterThan(yard.areaSqm + 2500);
  });

  it("does not join farmland with ten cars at its edge", () => {
    const outcome = vehicleParcelStage(
      input({
        parcels: [yard, parcel(neighbour, { landUse: { open: 1 } })],
        vehicles: [...cars(-25, -25, 25, 25), ...edgeCars],
      }),
    );
    expectArea(outcome.result?.areaSqm, yard.areaSqm);
  });

  it("does not join a parcel that is a meadow on the image", () => {
    const outcome = vehicleParcelStage(
      input({
        parcels: [yard, parcel(neighbour, { landUse: commercial })],
        vehicles: [...cars(-25, -25, 25, 25), ...edgeCars],
        vegetationAt: greenEastOf(38),
      }),
    );
    expectArea(outcome.result?.areaSqm, yard.areaSqm);
  });

  it("still joins housing land that is full of cars", () => {
    const outcome = vehicleParcelStage(
      input({
        parcels: [yard, parcel(neighbour, { landUse: { residential: 1 } })],
        vehicles: [...cars(-25, -25, 25, 25), ...cars(31, -29, 79, 29)],
      }),
    );
    expect(outcome.result?.areaSqm).toBeGreaterThan(yard.areaSqm + 2500);
  });

  it("does not take in a house the lot encloses", () => {
    // U-shaped lot around a 20 × 20 m house plot open to the south.
    const west = parcel(rect(-40, -30, -10, 30), { landUse: commercial });
    const north = parcel(rect(-10, 10, 10, 30), { landUse: commercial });
    const east = parcel(rect(10, -30, 40, 30), { landUse: commercial });
    const south = parcel(rect(-10, -30, 10, -10), { landUse: commercial });
    const house = parcel(rect(-10, -10, 10, 10), {
      landUse: { residential: 1 },
    });
    const outcome = vehicleParcelStage(
      input({
        anchor: at(-25, 0),
        parcels: [west, north, east, south, house],
        vehicles: [
          ...cars(-39, -29, -11, 29),
          ...cars(-9, 11, 9, 29),
          ...cars(11, -29, 39, 29),
          ...cars(-9, -29, 9, -11),
        ],
      }),
    );
    expect(outcome.reason).not.toContain("enclosed");
  });
});

describe("point moved to the dealership's address (v9)", () => {
  const road = parcel(rect(-100, -8, 100, 8), {
    address: "Hauptstraße",
    landUse: { traffic: 1 },
  });
  const dealer = parcel(rect(-30, 8, 30, 68), {
    address: "Hauptstraße 12",
    landUse: commercial,
  });
  const other = parcel(rect(-30, -68, 30, -8), {
    address: "Hauptstraße 11",
    landUse: commercial,
  });

  it("moves a point on the road to the parcel with the address", () => {
    const moved = addressAnchor(
      input({ address: "Hauptstraße 12", parcels: [road, dealer, other] }),
    );
    expect(moved).not.toBeNull();
    expect(moved!.distanceM).toBeCloseTo(8, 0);
    const outcome = runCascade(
      input({
        address: "Hauptstraße 12",
        parcels: [road, dealer, other],
        vehicles: cars(-25, 12, 25, 64),
      }),
    );
    expect(outcome.stage).toBe(1);
    expect(outcome.anchor).toBeDefined();
    expectArea(outcome.result?.areaSqm, dealer.areaSqm);
    expect(outcome.trace[0]).toContain("dealership's address");
  });

  it("moves a point on a parcel with another house number", () => {
    const moved = addressAnchor(
      input({
        anchor: at(0, -30),
        address: "Hauptstraße 12",
        parcels: [road, dealer, other],
      }),
    );
    expect(moved).not.toBeNull();
  });

  it("leaves a point on a parcel with another number alone when cars stand there", () => {
    expect(
      addressAnchor(
        input({
          anchor: at(0, -30),
          address: "Hauptstraße 12",
          parcels: [road, dealer, other],
          vehicles: cars(-10, -40, 10, -20),
        }),
      ),
    ).toBeNull();
  });

  it("leaves a point on a parcel without a house number alone", () => {
    const showroom = parcel(rect(-30, -68, 30, -8), {
      address: "Hauptstraße",
      landUse: commercial,
    });
    expect(
      addressAnchor(
        input({
          anchor: at(0, -30),
          address: "Hauptstraße 12",
          parcels: [road, dealer, showroom],
        }),
      ),
    ).toBeNull();
  });

  it("does nothing without an address or when the point's parcel carries it", () => {
    expect(addressAnchor(input({ parcels: [road, dealer] }))).toBeNull();
    expect(
      addressAnchor(
        input({
          anchor: at(0, 30),
          address: "Hauptstraße 12",
          parcels: [road, dealer],
        }),
      ),
    ).toBeNull();
  });
});

describe("vegetation on the image (v9)", () => {
  it("measures the share of a ring that is vegetation", () => {
    const share = greenShare(rect(0, -20, 40, 20), greenEastOf(30));
    expect(share).toBeGreaterThan(0.2);
    expect(share).toBeLessThan(0.3);
    expect(greenShare(rect(0, -20, 40, 20), undefined)).toBeNull();
    expect(greenShare(rect(0, -20, 40, 20), () => null)).toBeNull();
  });

  it("trims a wood at the edge of the parcel at the point", () => {
    // 60 m of yard with cars, then 60 m of wood on the same parcel.
    const plot = parcel(rect(-30, -30, 90, 30), { landUse: commercial });
    const lot = cars(-25, -25, 25, 25);
    const data = input({
      parcels: [plot],
      vehicles: lot,
      vegetationAt: greenEastOf(30),
    });
    const trimmed = trimVegetation(
      { type: "Polygon", coordinates: [plot.ring] },
      data,
      lot,
    );
    expect(trimmed).not.toBeNull();
    const area = geometryAreaSqm(trimmed!.geometry);
    expect(area).toBeGreaterThan(3400);
    expect(area).toBeLessThan(3900);
    const outcome = vehicleParcelStage(data);
    expect(outcome.result?.areaSqm).toBeLessThan(3900);
    expect(outcome.reason).toContain("vegetation without vehicles trimmed off");
  });

  it("keeps planted areas where vehicles stand and small green islands", () => {
    const plot = parcel(rect(-30, -30, 90, 30), { landUse: commercial });
    const everywhere = cars(-25, -25, 85, 25);
    expect(
      trimVegetation(
        { type: "Polygon", coordinates: [plot.ring] },
        input({ vehicles: everywhere, vegetationAt: greenEastOf(30) }),
        everywhere,
      ),
    ).toBeNull();
    // A 10 × 10 m island in the middle of the yard.
    const [west, south] = at(-5, -5);
    const [east, north] = at(5, 5);
    const island = ([lon, lat]: LonLat): boolean =>
      lon > west && lon < east && lat > south && lat < north;
    expect(
      trimVegetation(
        { type: "Polygon", coordinates: [plot.ring] },
        input({ vehicles: [], vegetationAt: island }),
        [],
      ),
    ).toBeNull();
  });
});

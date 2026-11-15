import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature, ParcelLandUse } from "../alkis.service";
import {
  isRoadParcel,
  parcelStage,
  runCascade,
  vehicleParcelStage,
  type CascadeInput,
} from "./cascade";

/**
 * Cascade v13 (docs/boundary-model.md, "Cascade v13"): a road parcel is
 * never the parcel at the point. Modelled on Dresdner Straße 263 in Freital:
 * the geocoded point lay on the carriageway, a single road parcel of
 * 22,000 m², and that parcel was returned as the lot.
 */

const ANCHOR: LonLat = [13.6456, 50.9941];

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
  return {
    ring: points,
    areaSqm: ringAreaSqm(points),
    state: "Sachsen",
    ...extra,
  };
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

// The point lies on a road 14 m wide and 700 m long.
const road = parcel(rect(-7, -350, 7, 350), {
  landUse: { traffic: 1 },
  address: "Dresdner Straße",
});
const yard = parcel(rect(7, -20, 47, 20), { landUse: { commercial: 1 } });
const house = parcel(rect(7, 20, 27, 45), {
  landUse: { residential: 1 },
  address: "Dresdner Straße 263",
});
const opposite = parcel(rect(-47, -20, -7, 20), {
  landUse: { residential: 1 },
});
const yardCars = cars(10, -18, 44, 18);
// Cars along the kerb, every 12 m over the whole road.
const kerbCars = cars(-7, -340, 7, 340, 12).filter((_, i) => i % 2 === 0);

describe("a point on a road parcel (v13)", () => {
  it("recognises a road by land use, and by shape where none is published", () => {
    expect(isRoadParcel(road, [road, yard])).toBe(true);
    expect(isRoadParcel(parcel(rect(-7, -350, 7, 350)), [yard])).toBe(true);
    expect(isRoadParcel(yard, [road, yard])).toBe(false);
    // A short narrow plot is a driveway or a parking strip, not a road.
    expect(isRoadParcel(parcel(rect(0, 0, 8, 40)), [yard])).toBe(false);
  });

  it("starts from the plot beside the road that holds the vehicles", () => {
    const outcome = vehicleParcelStage(
      input({
        parcels: [road, yard, house, opposite],
        vehicles: [...yardCars, ...kerbCars],
      }),
    );
    expect(outcome.result).not.toBeNull();
    expect(outcome.result!.areaSqm).toBeCloseTo(yard.areaSqm, -1);
    expect(outcome.reason).toContain("the point lies on a road parcel");
  });

  it("declines stage 1 when no plot beside the road holds a lot", () => {
    const outcome = vehicleParcelStage(
      input({ parcels: [road, yard, house, opposite], vehicles: kerbCars }),
    );
    expect(outcome.result).toBeNull();
    expect(outcome.reason).toContain("road parcel");
  });

  it("never returns the road as the parcel at the point (stage 4)", () => {
    const outcome = parcelStage(input({ parcels: [road, yard, house] }));
    expect(outcome.result).toBeNull();
    expect(outcome.reason).toContain("road");
  });

  it("returns no road area whatever the vehicles on it", () => {
    const outcome = runCascade(
      input({
        parcels: [road, yard, house, opposite],
        vehicles: [...yardCars, ...kerbCars],
      }),
    );
    expect(outcome.stage).toBe(1);
    expect(outcome.result!.areaSqm).toBeLessThan(road.areaSqm / 2);
    for (const candidate of [outcome.result!, ...outcome.alternatives]) {
      expect(candidate.areaSqm).toBeLessThan(road.areaSqm);
    }
  });

  it("moves to the address parcel when the address starts with the dealer's name", () => {
    const outcome = runCascade(
      input({
        address: "F&T Fahrzeug-Technik, Dresdner Str. 263, 01705 Freital",
        parcels: [road, yard, house, opposite],
        vehicles: [...yardCars, ...kerbCars],
      }),
    );
    expect(outcome.trace[0]).toContain(
      "the dealership's address is on a parcel",
    );
    expect(outcome.result!.areaSqm).toBeCloseTo(
      yard.areaSqm + house.areaSqm,
      -1,
    );
  });
});

import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import {
  borderShare,
  isShortStrip,
  isStreetLike,
  vehicleParcelStage,
  withoutHoles,
  type CascadeInput,
} from "./cascade";

/**
 * Cascade v8 rules (docs/boundary-model.md, "Cascade v8"): parcels that the
 * November 2026 parcel check found cut out of the lot — a small corner of the
 * yard with a few cars, a parking strip cut as its own plot, a plot the lot
 * encloses.
 */

const ANCHOR: LonLat = [7.0, 51.0];

function at(east: number, north: number): LonLat {
  return unprojectPoint([east, north], ANCHOR);
}

function ring(...points: Array<[number, number]>): LonLat[] {
  const result = points.map(([east, north]) => at(east, north));
  result.push(result[0]);
  return result;
}

function rect(
  west: number,
  south: number,
  east: number,
  north: number,
): LonLat[] {
  return ring([west, south], [east, south], [east, north], [west, north]);
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

function parcel(points: LonLat[]): ParcelFeature {
  return { ring: points, areaSqm: ringAreaSqm(points), state: "NRW" };
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

const yard = parcel(rect(-30, -30, 30, 30));

describe("small dense parcels (v8)", () => {
  it("joins a corner of the yard holding five cars, fewer than the ten a parcel needed", () => {
    // 25 × 20 m with five cars: 10 per 1,000 m², a yard corner, not a meadow.
    const corner = parcel(rect(30, 10, 55, 30));
    const outcome = vehicleParcelStage(
      input({
        vehicles: [...cars(-30, -30, 30, 30), ...cars(30, 20, 55, 25)],
        parcels: [yard, corner],
      }),
    );
    expect(outcome.result?.areaSqm).toBeCloseTo(3_600 + 500, -2);
  });

  it("keeps a neighbour out whose courtyard holds three cars, however densely", () => {
    const courtyard = parcel(rect(30, 10, 55, 30));
    const outcome = vehicleParcelStage(
      input({
        vehicles: [
          ...cars(-30, -30, 30, 30),
          at(32.5, 22.5),
          at(37.5, 22.5),
          at(42.5, 22.5),
        ],
        parcels: [yard, courtyard],
      }),
    );
    expect(outcome.result?.areaSqm).toBeCloseTo(3_600, -2);
  });

  it("keeps a large parcel out when the same five cars stand at its edge", () => {
    // 25 × 120 m: five cars are 1.7 per 1,000 m².
    const field = parcel(rect(30, -90, 55, 30));
    const outcome = vehicleParcelStage(
      input({
        vehicles: [...cars(-30, -30, 30, 30), ...cars(30, 20, 55, 25)],
        parcels: [yard, field],
      }),
    );
    expect(outcome.result?.areaSqm).toBeCloseTo(3_600, -2);
  });
});

describe("parking strips (v8)", () => {
  it("tells a short narrow plot from a long road", () => {
    expect(isShortStrip(rect(-30, 30, 30, 38))).toBe(true);
    expect(isShortStrip(rect(0, 0, 15, 400))).toBe(false);
    expect(isStreetLike(rect(0, 0, 15, 400))).toBe(true);
    expect(isShortStrip(rect(0, 0, 40, 40))).toBe(false);
  });

  it("joins a row of display cars on its own strip, but nothing grows from the strip", () => {
    const strip = parcel(rect(-30, 30, 30, 38));
    // Beyond the strip: a plot full of cars that touches only the strip.
    const beyond = parcel(rect(-30, 38, 30, 70));
    const outcome = vehicleParcelStage(
      input({
        vehicles: [
          ...cars(-30, -30, 30, 30),
          ...cars(-30, 30, 30, 38, 5),
          ...cars(-30, 41, 30, 70),
        ],
        parcels: [yard, strip, beyond],
      }),
    );
    expect(outcome.result?.areaSqm).toBeCloseTo(3_600 + 480, -2);
  });

  it("keeps a strip with two cars out", () => {
    const strip = parcel(rect(-30, 30, 30, 38));
    const outcome = vehicleParcelStage(
      input({
        vehicles: [...cars(-30, -30, 30, 30), at(-20, 34), at(-10, 34)],
        parcels: [yard, strip],
      }),
    );
    expect(outcome.result?.areaSqm).toBeCloseTo(3_600, -2);
  });

  it("never joins a long road, however many cars stand at its kerb", () => {
    const road = parcel(rect(30, -200, 42, 200));
    const outcome = vehicleParcelStage(
      input({
        vehicles: [...cars(-30, -30, 30, 30), ...cars(30, -30, 42, 30, 6)],
        parcels: [yard, road],
      }),
    );
    expect(outcome.result?.areaSqm).toBeCloseTo(3_600, -2);
  });
});

describe("enclosed parcels (v8)", () => {
  // A yard wrapping a 20 × 20 m plot on three sides.
  const wrapping = parcel(
    ring(
      [-30, -30],
      [30, -30],
      [30, 30],
      [10, 30],
      [10, 10],
      [-10, 10],
      [-10, 30],
      [-30, 30],
    ),
  );
  const notch = parcel(rect(-10, 10, 10, 30));

  it("measures how much of a parcel's outline the lot borders", () => {
    expect(borderShare(notch, [wrapping.ring])).toBeGreaterThanOrEqual(0.75);
    expect(
      borderShare(parcel(rect(30, -30, 60, 30)), [wrapping.ring]),
    ).toBeLessThan(0.5);
  });

  it("joins a plot the lot encloses even without cars on it", () => {
    const outcome = vehicleParcelStage(
      input({
        vehicles: cars(-30, -30, 30, 5),
        parcels: [wrapping, notch],
      }),
    );
    expect(outcome.result?.areaSqm).toBeCloseTo(3_600, -2);
    expect(outcome.result?.polygon.type).toBe("Polygon");
  });

  it("keeps out an empty neighbour the lot only borders on one side", () => {
    const neighbour = parcel(rect(30, -30, 60, 30));
    const outcome = vehicleParcelStage(
      input({
        vehicles: cars(-30, -30, 30, 5),
        parcels: [yard, neighbour],
      }),
    );
    expect(outcome.result?.areaSqm).toBeCloseTo(3_600, -2);
  });
});

describe("holes", () => {
  it("drops interior rings and keeps every part", () => {
    const outer = rect(-30, -30, 30, 30);
    const hole = rect(-5, -5, 5, 5);
    expect(
      withoutHoles({ type: "Polygon", coordinates: [outer, hole] }),
    ).toEqual({ type: "Polygon", coordinates: [outer] });
    expect(
      withoutHoles({
        type: "MultiPolygon",
        coordinates: [[outer, hole], [rect(40, 40, 50, 50)]],
      }),
    ).toEqual({
      type: "MultiPolygon",
      coordinates: [[outer], [rect(40, 40, 50, 50)]],
    });
  });
});

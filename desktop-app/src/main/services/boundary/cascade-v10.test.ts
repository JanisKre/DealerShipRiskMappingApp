import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { geometryAreaSqm } from "@shared/boundary-geometry-utils";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature, ParcelLandUse } from "../alkis.service";
import {
  CASCADE_CONFIDENCE,
  vehicleParcelStage,
  type CascadeInput,
} from "./cascade";

/**
 * Cascade v10 (docs/boundary-model.md, "Cascade v10"): a second part of the
 * lot directly across a street joins when it is a dense car lot or carries
 * the dealership's address.
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

const COMMERCIAL: ParcelLandUse = { commercial: 1 };
const yard = parcel(rect(-30, -30, 30, 30), {
  landUse: COMMERCIAL,
  address: "Hauptstraße 10",
});
const street = parcel(rect(30, -100, 42, 100), { landUse: { traffic: 1 } });
// A column of kerbside cars on the street links the two lots.
const kerb = cars(30, -30, 42, 30, 12);

function across(
  extra: { address?: string; landUse?: ParcelLandUse } = {},
): ParcelFeature {
  return parcel(rect(42, -30, 72, 30), { landUse: COMMERCIAL, ...extra });
}

describe("a second lot across the street (v10)", () => {
  it("joins a dense car lot directly across the street as a second part", () => {
    const outcome = vehicleParcelStage(
      input({
        vehicles: [
          ...cars(-30, -30, 30, 30),
          ...kerb,
          ...cars(42, -30, 72, 30),
        ],
        parcels: [yard, street, across()],
      }),
    );
    const result = outcome.result!;
    expect(result.polygon.type).toBe("MultiPolygon");
    expect(geometryAreaSqm(result.polygon)).toBeGreaterThan(3_600 + 1_700);
    expect(outcome.reason).toContain("1 across the street");
    // The rule's guess is offered for review.
    expect(result.confidence).toBe(CASCADE_CONFIDENCE.vehicleParcelsPartial);
  });

  it("never joins the street itself", () => {
    const outcome = vehicleParcelStage(
      input({
        vehicles: [
          ...cars(-30, -30, 30, 30),
          ...kerb,
          ...cars(42, -30, 72, 30),
        ],
        parcels: [yard, street, across()],
      }),
    );
    const area = geometryAreaSqm(outcome.result!.polygon);
    expect(area).toBeLessThan(3_600 + 1_800 + 100);
  });

  it("keeps a sparsely used car park across the street out", () => {
    const outcome = vehicleParcelStage(
      input({
        vehicles: [
          ...cars(-30, -30, 30, 30),
          ...kerb,
          at(45, 0),
          at(50, 0),
          at(55, 0),
        ],
        parcels: [yard, street, across()],
      }),
    );
    expect(outcome.result!.polygon.type).toBe("Polygon");
    expect(outcome.reason).not.toContain("across the street");
  });

  it("joins a plot across the street with the dealership's address and a few cars", () => {
    const outcome = vehicleParcelStage(
      input({
        vehicles: [
          ...cars(-30, -30, 30, 30),
          ...kerb,
          at(45, 0),
          at(50, 0),
          at(55, 0),
        ],
        parcels: [yard, street, across({ address: "Hauptstraße 10" })],
      }),
    );
    expect(outcome.reason).toContain("1 across the street");
  });

  it("keeps housing across the street out, however full", () => {
    const outcome = vehicleParcelStage(
      input({
        vehicles: [
          ...cars(-30, -30, 30, 30),
          ...kerb,
          ...cars(42, -30, 72, 30),
        ],
        parcels: [yard, street, across({ landUse: { residential: 1 } })],
      }),
    );
    expect(outcome.reason).not.toContain("across the street");
  });
});

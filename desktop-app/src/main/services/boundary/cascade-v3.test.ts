import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { geometryAreaSqm } from "@shared/boundary-geometry-utils";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import {
  CASCADE_CONFIDENCE,
  finalizeCascadeResult,
  isFieldStrip,
  isStreetLike,
  runCascade,
  streetParcels,
  vehicleHullStage,
  vehicleLot,
  siteStage,
  type CascadeInput,
} from "./cascade";

/**
 * Cascade v3 rules (docs/boundary-model.md, "Cascade v3"). Each case is a
 * small synthetic site modelled on one of the failures of the November 2026
 * audit.
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
  const ring = [
    at(west, south),
    at(east, south),
    at(east, north),
    at(west, north),
  ];
  ring.push(ring[0]);
  return ring;
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

function parcel(ring: LonLat[]): ParcelFeature {
  return { ring, areaSqm: ringAreaSqm(ring), state: "NRW" };
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

describe("street test (v3)", () => {
  it("keeps an L-shaped yard full of cars, which the old elongation test rejected", () => {
    // 39 × 97 m bounding box, arms 15 m wide: 2·A/U is about 16 m.
    const yard: LonLat[] = [
      at(0, 0),
      at(39, 0),
      at(39, 15),
      at(15, 15),
      at(15, 97),
      at(0, 97),
      at(0, 0),
    ];
    expect(isStreetLike(yard)).toBe(false);
  });

  it("still recognises a long road, a narrow path and a deep narrow strip of road", () => {
    expect(isStreetLike(rect(0, 0, 15, 400))).toBe(true);
    expect(isStreetLike(rect(0, 0, 4, 90))).toBe(true);
    expect(isStreetLike(rect(0, 0, 8, 60))).toBe(true);
  });

  it("keeps a deep plot of 13 × 111 m and anything wider than 20 m", () => {
    expect(isStreetLike(rect(0, 0, 13, 111))).toBe(false);
    expect(isStreetLike(rect(0, 0, 30, 300))).toBe(false);
  });
});

describe("stage 1 (v3)", () => {
  it("does not join a meadow because a row of cars stands at its edge", () => {
    const home = parcel(rect(-40, -40, 40, 40));
    const meadow = parcel(rect(-40, 40, 140, 140));
    const result = siteStage(
      input({
        vehicles: [...cars(-35, -35, 35, 35), ...cars(-35, 40, 35, 50)],
        parcels: [home, meadow],
      }),
    );
    expect(result.result).not.toBeNull();
    expectArea(result.result!.areaSqm, home.areaSqm);
  });

  it("joins a showroom parcel that is mostly roof", () => {
    const home = parcel(rect(-40, -40, 40, 40));
    const showroom = parcel(rect(40, -40, 100, 40));
    const roof = rect(42, -38, 98, 30);
    const result = siteStage(
      input({
        vehicles: [...cars(-35, -35, 35, 35), ...cars(40, 30, 98, 40)],
        parcels: [home, showroom],
        buildings: [roof],
      }),
    );
    expectArea(result.result!.areaSqm, home.areaSqm + showroom.areaSqm);
  });

  it("joins the yard of a small dealer that never holds ten cars", () => {
    const shop = parcel(rect(-10, -10, 15, 15));
    const yard = parcel(rect(15, -10, 45, 15));
    const result = siteStage(
      input({
        vehicles: [at(0, 18), at(5, 18), at(10, 18), ...cars(17, -8, 32, 2)],
        parcels: [shop, yard],
      }),
    );
    expectArea(result.result!.areaSqm, shop.areaSqm + yard.areaSqm);
  });
});

describe("anchor reach (v3)", () => {
  it("finds the cars around a showroom when the point sits on its roof", () => {
    // Showroom 90 × 90 m with the point at its centre; cars 5 m off its walls,
    // 50 m from the point.
    const showroom = rect(-45, -45, 45, 45);
    const yard = cars(-45, 47, 45, 60);
    expect(vehicleLot(yard, ANCHOR)).toHaveLength(0);
    expect(vehicleLot(yard, ANCHOR, undefined, showroom).length).toBe(
      yard.length,
    );
  });

  it("reaches 40 m from the point without footprints", () => {
    const row = cars(30, -10, 60, 10);
    expect(vehicleLot(row, ANCHOR)).toHaveLength(row.length);
  });
});

describe("stage 2 outline (v3)", () => {
  it("includes the showroom the rows stand around", () => {
    const showroom = rect(-20, -20, 20, 20);
    const vehicles = [
      ...cars(-40, -40, 40, -25),
      ...cars(-40, 25, 40, 40),
      ...cars(-40, -25, -25, 25),
      ...cars(25, -25, 40, 25),
    ];
    const without = vehicleHullStage(input({ vehicles }));
    const withBuilding = vehicleHullStage(
      input({ vehicles, buildings: [showroom] }),
    );
    expect(withBuilding.result).not.toBeNull();
    expect(withBuilding.result!.areaSqm).toBeGreaterThanOrEqual(
      without.result!.areaSqm,
    );
    // No hole where the showroom stands.
    const geometry = withBuilding.result!.polygon;
    const rings =
      geometry.type === "Polygon"
        ? geometry.coordinates
        : geometry.coordinates.flat();
    expect(rings).toHaveLength(1);
    expect(withBuilding.result!.confidence).toBe(
      CASCADE_CONFIDENCE.vehicleHull,
    );
  });

  it("stops at a street parcel instead of following kerbside cars", () => {
    const road = parcel(rect(-200, 45, 200, 60));
    const vehicles = [...cars(-40, -40, 40, 40), ...cars(-40, 47, 40, 58)];
    const result = vehicleHullStage(input({ vehicles, parcels: [road] }));
    const north = Math.max(
      ...(result.result!.polygon.type === "Polygon"
        ? result.result!.polygon.coordinates[0]
        : result.result!.polygon.coordinates.flat(2)
      ).map(([, lat]) => lat as number),
    );
    expect(north).toBeLessThanOrEqual(at(0, 46)[1]);
  });
});

describe("review flags (v3)", () => {
  it("flags a capped cadastre answer that lacks the parcel at the point", () => {
    const elsewhere = parcel(rect(50, 50, 100, 100));
    const outcome = runCascade(
      input({
        vehicles: cars(-20, -20, 20, 20),
        parcels: [elsewhere],
        parcelsTruncated: true,
      }),
    );
    expect(outcome.flags).toContain("cadastreIncomplete");
  });

  it("flags detected vehicles that form no lot at the point", () => {
    const outcome = runCascade(input({ vehicles: cars(150, 150, 170, 170) }));
    expect(outcome.result).toBeNull();
    expect(outcome.flags).toContain("noLotAtPoint");
  });

  it("does not count cars parked on a street parcel as a clipped lot", () => {
    const home = parcel(rect(-40, -40, 40, 40));
    const road = parcel(rect(-300, 40, 300, 52));
    const vehicles = [...cars(-35, -35, 35, 35), ...cars(-35, 41, 35, 51)];
    const outcome = runCascade(input({ vehicles, parcels: [home, road] }));
    const result = finalizeCascadeResult(
      outcome.result!,
      outcome.stage!,
      ANCHOR,
      outcome.alternatives,
      outcome.trace,
      DEFAULT_RISK_PARAMETERS,
      vehicles,
      { parcels: [home, road], lotVehicles: outcome.lotVehicles },
    );
    expect(result.quality?.vehiclesOutsideNearby).toBe(0);
    expect(result.quality?.lotVehicles).toBe(outcome.lotVehicles);
  });
});

describe("field strips (v3.1)", () => {
  // Five 12 m × 300 m strips side by side, running north from the road;
  // the dealership stands across three of them near the road.
  const strips = [0, 1, 2, 3, 4].map((i) =>
    parcel(rect(-30 + i * 12, -20, -18 + i * 12, 280)),
  );
  const road = parcel(rect(-300, -32, 300, -20));

  it("tells field strips from streets", () => {
    const all = [...strips, road];
    expect(isFieldStrip(strips[2], all)).toBe(true);
    expect(isFieldStrip(road, all)).toBe(false);
    const streets = streetParcels(all);
    expect(streets.has(road)).toBe(true);
    expect(streets.has(strips[2])).toBe(false);
  });

  it("outlines the vehicles when the point lies on a field strip", () => {
    const outcome = runCascade(
      input({
        vehicles: cars(-25, -15, 20, 30),
        parcels: [...strips, road],
      }),
    );
    expect(outcome.stage).toBe(2);
    expect(outcome.trace.join(" ")).toMatch(/field strip/);
    // The outline covers the lot across the strips, not one strip to the field.
    expect(outcome.result!.areaSqm).toBeGreaterThan(1_500);
    expect(outcome.result!.areaSqm).toBeLessThan(4_500);
  });
});

describe("building at the point (v4)", () => {
  it("adds the building complex the point lies in, even with cars on one side only", () => {
    // Showroom 60 × 40 m with a workshop attached to its west wall; the point
    // on the showroom roof; the cars stand east of the showroom only.
    const showroom = rect(-30, -20, 30, 20);
    const workshop = rect(-60, -20, -30, 20);
    const vehicles = cars(32, -20, 60, 20);
    const without = vehicleHullStage(input({ vehicles }));
    const withComplex = vehicleHullStage(
      input({ vehicles, buildings: [showroom, workshop] }),
    );
    expect(withComplex.result!.areaSqm).toBeGreaterThan(
      without.result!.areaSqm + 2_000,
    );
    const geometry = withComplex.result!.polygon;
    const rings =
      geometry.type === "Polygon"
        ? [geometry.coordinates[0]]
        : geometry.coordinates.map((part) => part[0]);
    // One part, reaching the west wall of the workshop.
    expect(rings).toHaveLength(1);
    const west = Math.min(...rings[0].map(([lon]) => lon));
    expect(west).toBeLessThan(at(-55, 0)[0]);
  });
});

describe("traffic areas without street parcels (Bayern)", () => {
  it("cuts the outline back at the road and drops the part beyond it", () => {
    // Lot south of a 15 m road; kerbside cars on the road; no parcels.
    const vehicles = [...cars(-40, -40, 40, 40), ...cars(-40, 43, 40, 54)];
    const roadAt = ([, lat]: [number, number]): boolean =>
      lat >= at(0, 41)[1] && lat <= at(0, 56)[1];
    const plain = vehicleHullStage(input({ vehicles }));
    const cut = vehicleHullStage(input({ vehicles, isStreetAt: roadAt }));
    const north = (r: typeof plain): number =>
      Math.max(
        ...(r.result!.polygon.type === "Polygon"
          ? r.result!.polygon.coordinates[0]
          : r.result!.polygon.coordinates.flat(2)
        ).map(([, lat]) => lat as number),
      );
    expect(north(plain)).toBeGreaterThan(at(0, 56)[1]);
    expect(north(cut)).toBeLessThanOrEqual(at(0, 42)[1]);
  });
});

describe("tiny parcel at the point (v4)", () => {
  it("outlines the vehicles when the parcel at the point is a sliver with nothing joined", () => {
    const sliver = parcel(rect(-6, -6, 6, 6));
    const outcome = runCascade(
      input({ vehicles: cars(10, -30, 60, 30), parcels: [sliver] }),
    );
    expect(outcome.trace[0]).toBe(
      "stage 1: no vehicle lot on the parcels at the point",
    );
    expect(outcome.stage).toBe(2);
    // The sliver itself stays on offer.
    expect(outcome.alternatives.map((a) => a.provider)).toContain(
      "alkis-parcel",
    );
  });

  it("returns the sliver, not the circle, when there is no lot to outline", () => {
    const sliver = parcel(rect(-6, -6, 6, 6));
    const outcome = runCascade(input({ vehicles: [], parcels: [sliver] }));
    expect(outcome.stage).toBe(4);
    expect(outcome.result?.provider).toBe("alkis-parcel");
    expect(outcome.flags).toContain("noLotAtPoint");
  });
});

function expectArea(actual: number | undefined, expected: number): void {
  expect(actual).toBeDefined();
  expect(Math.abs(actual! - expected) / expected).toBeLessThan(0.02);
}

// Keep the helper import used even when a case is skipped.
void geometryAreaSqm;

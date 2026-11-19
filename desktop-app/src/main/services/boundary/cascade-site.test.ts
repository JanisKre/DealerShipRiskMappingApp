import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import {
  CASCADE_CONFIDENCE,
  CASCADE_VERSION,
  finalizeCascadeResult,
  geometryContains,
  runCascade,
  siteStage,
  type CascadeInput,
} from "./cascade";

/**
 * Stage 1 since cascade v16: the site as whole parcels chosen by the site
 * model (docs/boundary-model.md, "Site model"). Each case is a small
 * synthetic site with evidence clear enough not to hang on a weight.
 */

const ANCHOR: LonLat = [13.4, 52.5];

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

function cars(
  west: number,
  south: number,
  east: number,
  north: number,
): LonLat[] {
  const points: LonLat[] = [];
  for (let x = west + 2.5; x < east; x += 5) {
    for (let y = south + 2.5; y < north; y += 5) points.push(at(x, y));
  }
  return points;
}

const TRADE = { commercial: 1 };

function parcel(
  ring: LonLat[],
  extra: Partial<ParcelFeature> = {},
): ParcelFeature {
  return {
    ring,
    areaSqm: ringAreaSqm(ring),
    state: "Sachsen",
    landUse: TRADE,
    ...extra,
  };
}

function input(overrides: Partial<CascadeInput> = {}): CascadeInput {
  return {
    anchor: ANCHOR,
    vehicles: [],
    osm: null,
    parcels: [],
    // The whole scene is on the image and shows no vegetation.
    vegetationAt: () => false,
    parameters: DEFAULT_RISK_PARAMETERS,
    ...overrides,
  };
}

function expectArea(actual: number | undefined, expected: number): void {
  expect(actual).toBeDefined();
  expect(Math.abs(actual! - expected) / expected).toBeLessThan(0.01);
}

// The plot at the point (50 × 50 m, showroom and forecourt) and plots around.
const home = parcel(rect(-25, -25, 25, 25), { address: "Hauptstraße 5" });
const forecourt = cars(-22, -22, 22, -8); // 27 cars in front of the showroom

describe("site stage: no reach limit", () => {
  it("follows the yards as far as the dealer's rows go", () => {
    // Six 50 × 50 m yards in a row east of the showroom: the last one ends
    // 325 m from the point.
    const yards = [1, 2, 3, 4, 5, 6].map((i) =>
      parcel(rect(-25 + 50 * i, -25, 25 + 50 * i, 25)),
    );
    const outcome = siteStage(
      input({
        parcels: [home, ...yards],
        vehicles: cars(-22, -22, 322, 22),
      }),
    );
    expect(outcome.hasLot).toBe(true);
    expectArea(outcome.result?.areaSqm, 7 * 2500);
    expect(outcome.result?.confidence).toBe(CASCADE_CONFIDENCE.vehicleParcels);
    expect(outcome.alternatives).toEqual([]);
  });
});

describe("site stage: buildings", () => {
  it("takes the plot the showroom reaches onto", () => {
    const annex = parcel(rect(25, -25, 65, 25), { address: "Hauptstraße" });
    const showroom = rect(-10, -5, 45, 20); // 20 m of it on the annex plot
    const outcome = siteStage(
      input({
        parcels: [home, annex],
        vehicles: forecourt,
        buildings: [showroom],
      }),
    );
    expectArea(outcome.result?.areaSqm, 2500 + 2000);
  });

  it("leaves a neighbour with a hall and a house number of its own out", () => {
    const neighbour = parcel(rect(25, -25, 75, 25), {
      address: "Hauptstraße 7",
    });
    const outcome = siteStage(
      input({
        parcels: [home, neighbour],
        vehicles: [...forecourt, ...cars(60, -20, 70, 20)],
        buildings: [rect(-10, -5, 15, 20), rect(30, -5, 55, 20)],
      }),
    );
    expectArea(outcome.result?.areaSqm, 2500);
  });

  it("keeps a showroom across the parcel line whole when the plot stays out", () => {
    // A corner of the showroom on a meadow that does not join.
    const meadow = parcel(rect(25, -25, 125, 75), { landUse: { open: 1 } });
    const showroom = rect(-10, -5, 30, 20); // 5 m over the line
    const outcome = siteStage(
      input({
        parcels: [home, meadow],
        vehicles: forecourt,
        buildings: [showroom],
        vegetationAt: ([lon]) => lon > at(31, 0)[0],
      }),
    );
    expectArea(outcome.result?.areaSqm, 2500 + 5 * 25);
    expect(outcome.reason).toMatch(/1 building\(s\) across the parcel line/);
    expect(geometryContains(outcome.result!.polygon, at(28, 10))).toBe(true);
    expect(geometryContains(outcome.result!.polygon, at(60, 10))).toBe(false);
  });
});

describe("site stage: what the image shows on the line", () => {
  // A lot next door with its own number: twelve cars, one row of them
  // within reach of the dealer's rows.
  const next = parcel(rect(25, -25, 75, 25), { address: "Hauptstraße 7" });
  const vehicles = [...cars(-22, -22, 22, 22), ...cars(27, -22, 42, -2)];

  it("is less willing to join across a hedge than across open asphalt", () => {
    const open = siteStage(input({ parcels: [home, next], vehicles }));
    const hedged = siteStage(
      input({
        parcels: [home, next],
        vehicles,
        vegetationAt: ([lon]) => lon > at(24, 0)[0] && lon < at(26, 0)[0],
      }),
    );
    expect(hedged.result!.areaSqm).toBeLessThanOrEqual(open.result!.areaSqm);
    expectArea(hedged.result?.areaSqm, 2500);
  });
});

describe("site stage: plots that never join", () => {
  it("keeps the road out, however many cars park on it", () => {
    const road = parcel(rect(-200, -37, 200, -25), { landUse: { traffic: 1 } });
    const outcome = siteStage(
      input({
        parcels: [home, road],
        vehicles: [...forecourt, ...cars(-100, -36, 100, -26)],
      }),
    );
    expectArea(outcome.result?.areaSqm, 2500);
  });

  it("keeps a car compound out that only touches the site at a corner", () => {
    // 150 × 150 m of parked cars, sharing 10 m of border with the plot.
    const compound = parcel(rect(25, 15, 175, 165));
    const outcome = siteStage(
      input({
        parcels: [home, compound],
        vehicles: [...cars(-22, -22, 22, 22), ...cars(27, 17, 173, 163)],
      }),
    );
    expectArea(outcome.result?.areaSqm, 2500);
  });

  it("keeps the neighbour's house and garden out", () => {
    const house = parcel(rect(25, -25, 55, 25), {
      address: "Hauptstraße 7",
      landUse: { residential: 1 },
    });
    const outcome = siteStage(
      input({
        parcels: [home, house],
        vehicles: [...forecourt, at(40, -20), at(45, -20)],
        buildings: [rect(-10, -5, 15, 20), rect(32, 0, 48, 15)],
      }),
    );
    expectArea(outcome.result?.areaSqm, 2500);
  });
});

describe("site stage: notches and holes", () => {
  it("takes a small plot the site all but encloses", () => {
    // A transformer plot cut out of the north side of the yard.
    const yard = parcel(rect(-25, 25, 25, 75));
    const transformer = parcel(rect(-5, 20, 5, 30));
    const cut = parcel([
      at(-25, -25),
      at(25, -25),
      at(25, 25),
      at(5, 25),
      at(5, 20),
      at(-5, 20),
      at(-5, 25),
      at(-25, 25),
      at(-25, -25),
    ]);
    const outcome = siteStage(
      input({
        parcels: [cut, yard, transformer],
        vehicles: [...cars(-22, -22, 22, 10), ...cars(-22, 32, 22, 72)],
      }),
    );
    expectArea(outcome.result?.areaSqm, 5000);
    expect(geometryContains(outcome.result!.polygon, at(0, 24))).toBe(true);
  });
});

describe("site stage: the plot at the point", () => {
  it("starts from the plot beside the road when the point lies on the road", () => {
    const road = parcel(rect(-200, -6, 200, 6), { landUse: { traffic: 1 } });
    const north = parcel(rect(-25, 6, 25, 56));
    const south = parcel(rect(-25, -56, 25, -6));
    const outcome = siteStage(
      input({
        parcels: [road, north, south],
        vehicles: [
          ...cars(-22, 8, 22, 54),
          at(0, -20),
          at(5, -20),
          at(10, -20),
        ],
      }),
    );
    expect(outcome.reason).toMatch(/road parcel; the plot beside it/);
    expect(geometryContains(outcome.result!.polygon, at(0, 30))).toBe(true);
    expect(geometryContains(outcome.result!.polygon, at(0, -30))).toBe(false);
  });

  it("declines on a road with no vehicles beside it", () => {
    const road = parcel(rect(-200, -6, 200, 6), { landUse: { traffic: 1 } });
    const outcome = siteStage(
      input({ parcels: [road, parcel(rect(-25, 6, 25, 56))] }),
    );
    expect(outcome.result).toBeNull();
    expect(outcome.reason).toMatch(/road parcel and no plot within/);
  });

  it("finds the yard behind a house plot that shows no cars itself", () => {
    // The geocoder's point on the owner's house; the dealership behind it.
    const house = parcel(rect(-12, -12, 12, 12), { address: "Hauptstraße 5" });
    const yard = parcel(rect(-12, 12, 48, 62), { address: "Hauptstraße" });
    const outcome = siteStage(
      input({
        parcels: [house, yard],
        vehicles: cars(-10, 14, 46, 60),
        buildings: [rect(-8, -8, 8, 8)],
      }),
    );
    expect(outcome.hasLot).toBe(true);
    expectArea(outcome.result?.areaSqm, 576 + 3000);
  });
});

describe("site stage: doubts", () => {
  // A second lot beside the dealer's, under another house number and with a
  // hall of its own, its rows running on from the dealer's: nothing on the
  // image or in the cadastre says whose it is.
  const second = parcel(rect(25, -25, 75, 25), { address: "Hauptstraße 7" });
  const doubtful = input({
    parcels: [home, second],
    vehicles: [...cars(-22, -22, 22, 22), ...cars(27, -22, 73, -2)],
    buildings: [rect(-10, 0, 15, 20), rect(35, 5, 65, 20)],
  });

  it("flags a parcel it is not sure about and offers the site both ways", () => {
    const outcome = siteStage(doubtful);
    expect(outcome.reason).toMatch(
      /in doubt: \d+ m² (joined|left out) at \d+%/,
    );
    expect(outcome.result?.confidence).toBe(
      CASCADE_CONFIDENCE.vehicleParcelsPartial,
    );
    expect(outcome.alternatives).toHaveLength(1);
    const [other] = outcome.alternatives;
    expect(["alkis-site-core", "alkis-site-extended"]).toContain(
      other.provider,
    );
    // The two between them are the plot alone and both plots.
    const areas = [outcome.result!.areaSqm, other.areaSqm].sort(
      (a, b) => a - b,
    );
    expectArea(areas[0], 2500);
    expectArea(areas[1], 5000);
  });

  it("sends a result with a doubt to review, and a sure one not", () => {
    const review = (given: CascadeInput): boolean => {
      const outcome = runCascade(given);
      const result = finalizeCascadeResult(
        outcome.result!,
        outcome.stage!,
        ANCHOR,
        outcome.alternatives,
        outcome.trace,
        DEFAULT_RISK_PARAMETERS,
        given.vehicles,
        { parcels: given.parcels, lotVehicles: outcome.lotVehicles },
      );
      expect(result.quality?.resultVersion).toBe(CASCADE_VERSION);
      return (
        result.confidence < DEFAULT_RISK_PARAMETERS.boundaryReviewConfidence
      );
    };
    expect(review(doubtful)).toBe(true);
    expect(review(input({ parcels: [home], vehicles: forecourt }))).toBe(false);
  });
});

describe("site stage: image extent", () => {
  const yard = parcel(rect(25, -25, 125, 25));
  const vehicles = cars(-22, -22, 60, 22);

  it("asks for the wider image when a parcel of the site lies partly outside it", () => {
    const [west, south] = at(-70, -70);
    const [east, north] = at(70, 70);
    const outcome = runCascade(
      input({
        parcels: [home, yard],
        vehicles,
        imageBounds: [west, south, east, north],
      }),
    );
    expect(outcome.stage).toBe(1);
    expect(outcome.imageTooSmall).toBe(true);
    const result = finalizeCascadeResult(
      outcome.result!,
      1,
      ANCHOR,
      outcome.alternatives,
      outcome.trace,
      DEFAULT_RISK_PARAMETERS,
      vehicles,
      { parcels: [home, yard], imageTooSmall: outcome.imageTooSmall },
    );
    expect(result.quality?.possiblyIncomplete).toBe(true);
  });

  it("does not ask when the site lies on the image", () => {
    const [west, south] = at(-190, -190);
    const [east, north] = at(190, 190);
    const outcome = runCascade(
      input({
        parcels: [home, yard],
        vehicles,
        imageBounds: [west, south, east, north],
      }),
    );
    expect(outcome.imageTooSmall).toBeUndefined();
  });
});

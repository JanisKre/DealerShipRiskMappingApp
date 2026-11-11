import { describe, expect, it } from "vitest";
import { DEFAULT_RISK_PARAMETERS } from "@shared/parameters";
import type { BoundaryResult } from "@shared/types";
import { boundaryNeedsReview } from "@shared/boundary-review";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import type { EvidenceArea, OsmEvidence } from "./osm-overpass";
import {
  CASCADE_CONFIDENCE,
  finalizeCascadeResult,
  isStreetLike,
  osmDealerStage,
  parcelStage,
  runCascade,
  vehicleHullStage,
  vehicleLot,
  vehicleParcelStage,
  type CascadeInput,
} from "./cascade";

const ANCHOR: LonLat = [13.4, 52.5];

/** Point in metres east/north of the anchor. */
function at(east: number, north: number): LonLat {
  return unprojectPoint([east, north], ANCHOR);
}

/** Axis-aligned rectangle in metres relative to the anchor. */
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

/** A parking grid of vehicles 5 m apart filling the rectangle. */
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

function parcel(ring: LonLat[]): ParcelFeature {
  return { ring, areaSqm: ringAreaSqm(ring), state: "Sachsen" };
}

let nextId = 1;
function dealerArea(
  ring: LonLat[],
  tags: Record<string, string> = {},
): EvidenceArea {
  return {
    kind: "dealerArea",
    ring,
    tags: { shop: "car", ...tags },
    osmType: "way",
    osmId: nextId++,
  };
}

function osm(...areas: EvidenceArea[]): OsmEvidence {
  return { areas, lines: [], addressNodes: [] };
}

/**
 * Geodesic and planar areas differ by a fraction of a percent; outlines are
 * traced on a 1 m raster, so they get a looser tolerance.
 */
function expectArea(
  actual: number | undefined,
  expected: number,
  tolerance = 0.01,
): void {
  expect(actual).toBeDefined();
  expect(Math.abs(actual! - expected) / expected).toBeLessThan(tolerance);
}

function input(overrides: Partial<CascadeInput> = {}): CascadeInput {
  return {
    anchor: ANCHOR,
    vehicles: [],
    osm: null,
    parcels: [],
    parameters: DEFAULT_RISK_PARAMETERS,
    ...overrides,
  };
}

describe("vehicle lot", () => {
  it("keeps rows linked across an aisle and drops a lot across a road", () => {
    const own = [...cars(-20, -10, 20, 0), ...cars(-20, 7, 20, 17)]; // 7 m aisle
    const acrossRoad = cars(-20, 40, 20, 60); // 23 m away
    const lot = vehicleLot([...own, ...acrossRoad], ANCHOR);
    expect(lot).toHaveLength(own.length);
  });

  it("does not outline a handful of cars", () => {
    const outcome = vehicleHullStage(
      input({ vehicles: cars(-10, -10, 10, 10) }),
    );
    expect(outcome.result).toBeNull();
    expect(outcome.reason).toMatch(/too few/);
  });

  it("ignores a few cars on the kerb", () => {
    expect(vehicleLot([at(0, 5), at(5, 5)], ANCHOR)).toEqual([]);
  });

  it("takes a cluster on the anchor parcel even when it is far from the pin", () => {
    const yard = cars(40, -10, 70, 10); // nearest centre 42.5 m from the pin
    expect(vehicleLot(yard, ANCHOR)).toEqual([]);
    expect(vehicleLot(yard, ANCHOR, rect(-20, -20, 80, 20))).toHaveLength(
      yard.length,
    );
  });

  it("never reaches beyond 80 m", () => {
    // A continuous row from the pin out to 200 m.
    const row = Array.from({ length: 41 }, (_, i) => at(i * 5, 0));
    expect(vehicleLot(row, ANCHOR)).toHaveLength(17); // 0…80 m
  });
});

describe("street-like parcels", () => {
  it("recognises a street but not a deep lot", () => {
    expect(isStreetLike(rect(0, 0, 200, 12))).toBe(true);
    expect(isStreetLike(rect(0, 0, 60, 20))).toBe(false);
    expect(isStreetLike(rect(0, 0, 80, 80))).toBe(false);
  });
});

describe("stage 1: parcels holding the vehicle lot", () => {
  // The Autopark case: a small showroom parcel and the yard next to it.
  const showroom = parcel(rect(-12, -12, 12, 12)); // 576 m²
  const yard = parcel(rect(-52, -12, -12, 12)); // west neighbour, 960 m²
  const neighbour = parcel(rect(12, -12, 52, 12)); // east, no cars
  const street = parcel(rect(-60, -24, 60, -12)); // south, 120 × 12 m

  it("joins the adjacent parcel full of vehicles, not the empty one or the street", () => {
    const vehicles = [
      ...cars(-50, -10, -14, 10),
      at(0, 5),
      at(5, 5),
      at(-5, 5),
    ];
    const outcome = vehicleParcelStage(
      input({ parcels: [showroom, yard, neighbour, street], vehicles }),
    );
    expect(outcome.result?.provider).toBe("alkis-vehicle-parcels");
    expect(outcome.result?.role).toBe("operationalLot");
    expect(outcome.result?.confidence).toBe(CASCADE_CONFIDENCE.vehicleParcels);
    expectArea(outcome.result?.areaSqm, 576 + 960);
  });

  it("grows across several parcels in a row", () => {
    const far = parcel(rect(-92, -12, -52, 12));
    const vehicles = cars(-90, -10, 10, 10);
    const outcome = vehicleParcelStage(
      input({ parcels: [showroom, yard, far], vehicles }),
    );
    expectArea(outcome.result?.areaSqm, 576 + 960 + 960);
  });

  it("lowers confidence when the parcels hold only part of the lot", () => {
    // Most cars stand on the street parcel, which never joins.
    const vehicles = [...cars(-10, -10, 10, 10), ...cars(-58, -22, 58, -14)];
    const outcome = vehicleParcelStage(
      input({ parcels: [showroom, street], vehicles }),
    );
    expect(outcome.result?.confidence).toBe(
      CASCADE_CONFIDENCE.vehicleParcelsPartial,
    );
  });

  it("declines without vehicles, without a parcel, or on an estate parcel", () => {
    expect(
      vehicleParcelStage(input({ parcels: [showroom], vehicles: null })).reason,
    ).toBe("no vehicle detection");
    expect(
      vehicleParcelStage(input({ parcels: [showroom], vehicles: [] })).reason,
    ).toBe("no vehicle lot at the point");
    expect(
      vehicleParcelStage(input({ vehicles: cars(-10, -10, 10, 10) })).reason,
    ).toBe("no cadastral parcels here");
    expect(
      vehicleParcelStage(
        input({
          parcels: [parcel(rect(-150, -150, 150, 150))],
          vehicles: cars(-10, -10, 10, 10),
        }),
      ).result,
    ).toBeNull();
  });
});

describe("stage 2: outline of the vehicle lot", () => {
  it("outlines the lot with a margin around the outermost vehicles", () => {
    const vehicles = cars(10, -20, 50, 20); // centres 12.5…47.5 m east
    const outcome = vehicleHullStage(input({ vehicles }));
    expect(outcome.result?.provider).toBe("vehicle-hull");
    expect(outcome.result?.confidence).toBe(CASCADE_CONFIDENCE.vehicleHull);
    // Centres span 35 × 35 m; with a 10 m margin about 55 × 55 m.
    // Disk stamps and a square erosion leave the corners slightly full.
    expectArea(outcome.result?.areaSqm, 55 * 55, 0.06);
  });

  it("follows an L-shaped lot instead of filling the corner", () => {
    const vehicles = [...cars(0, 0, 80, 20), ...cars(0, 20, 20, 80)];
    const outcome = vehicleHullStage(input({ vehicles }));
    // Centres: 75 × 15 m plus 15 × 60 m; with the 10 m margin the L covers
    // 95 × 35 + 35 × 60 m. Its 95 × 95 m bounding box is far larger.
    const area = outcome.result?.areaSqm ?? 0;
    expect(area).toBeGreaterThan(0.97 * (95 * 35 + 35 * 60));
    expect(area).toBeLessThan(0.7 * 95 * 95);
  });

  it("keeps two lots apart instead of bridging the road between them", () => {
    // Both rows come within 25 m of the pin; 45 m of road lie between them.
    const vehicles = [...cars(-20, -30, 20, -20), ...cars(-20, 20, 20, 30)];
    const outcome = vehicleHullStage(input({ vehicles }));
    expect(outcome.result?.polygon.type).toBe("MultiPolygon");
  });
});

describe("stage 3: OSM dealer area (cached)", () => {
  it("is used when there are no vehicles", () => {
    const outcome = osmDealerStage(
      input({ osm: osm(dealerArea(rect(-40, -30, 40, 30))) }),
    );
    expect(outcome.result?.provider).toBe("osm-dealer-area");
  });

  it("says when OSM is not cached", () => {
    expect(osmDealerStage(input()).reason).toBe("OSM not cached");
  });
});

describe("stage 4: parcel at the point", () => {
  it("returns the parcel for review", () => {
    const outcome = parcelStage(
      input({ parcels: [parcel(rect(-30, -30, 30, 30))] }),
    );
    expect(outcome.result?.role).toBe("parcel");
    expect(outcome.result?.confidence).toBe(CASCADE_CONFIDENCE.parcel);
  });
});

describe("cascade order", () => {
  it("prefers vehicle parcels over a cached OSM dealer area", () => {
    const outcome = runCascade(
      input({
        parcels: [parcel(rect(-30, -30, 30, 30))],
        vehicles: cars(-25, -25, 25, 25),
        osm: osm(dealerArea(rect(-10, -10, 10, 10))),
      }),
    );
    expect(outcome.stage).toBe(1);
    expect(outcome.alternatives.map((a) => a.provider)).toContain(
      "osm-dealer-area",
    );
  });

  it("does not offer the vehicle outline next to well-covering parcels", () => {
    const outcome = runCascade(
      input({
        parcels: [parcel(rect(-30, -30, 30, 30))],
        vehicles: cars(-25, -25, 25, 25),
      }),
    );
    expect(outcome.stage).toBe(1);
    expect(outcome.result?.confidence).toBe(CASCADE_CONFIDENCE.vehicleParcels);
    expect(outcome.alternatives.map((a) => a.provider)).not.toContain(
      "vehicle-hull",
    );
  });

  it("outlines the vehicles where there is no cadastre", () => {
    const outcome = runCascade(input({ vehicles: cars(-25, -25, 25, 25) }));
    expect(outcome.stage).toBe(2);
    expect(outcome.trace[0]).toBe("stage 1: no cadastral parcels here");
  });

  it("falls back to the parcel when no vehicles are seen", () => {
    const outcome = runCascade(
      input({ parcels: [parcel(rect(-30, -30, 30, 30))] }),
    );
    expect(outcome.stage).toBe(4);
  });

  it("returns no result when every stage declines", () => {
    const outcome = runCascade(input());
    expect(outcome.result).toBeNull();
    expect(outcome.trace).toHaveLength(4);
  });
});

describe("finalized results and review", () => {
  const parameters = DEFAULT_RISK_PARAMETERS;

  function finalize(cascadeInput: CascadeInput): BoundaryResult {
    const { result, stage, trace, alternatives } = runCascade(cascadeInput);
    return finalizeCascadeResult(
      result!,
      stage!,
      ANCHOR,
      alternatives,
      trace,
      parameters,
      cascadeInput.vehicles,
    );
  }

  it("does not send well-covered vehicle parcels to review", () => {
    const final = finalize(
      input({
        parcels: [parcel(rect(-30, -30, 30, 30))],
        vehicles: cars(-25, -25, 25, 25),
      }),
    );
    expect(final.quality?.usedEngine).toBe("cascade");
    expect(final.quality?.cascadeStage).toBe(1);
    expect(final.quality?.vehiclesOutsideNearby).toBe(0);
    expect(boundaryNeedsReview(final, parameters)).toBe(false);
  });

  it("sends a result with a row of cars just outside to review", () => {
    // The row stands on the street parcel, so it never joins.
    const final = finalize(
      input({
        parcels: [
          parcel(rect(-30, -30, 30, 30)),
          parcel(rect(-100, 30, 100, 42)),
        ],
        vehicles: [...cars(-25, -25, 25, 25), ...cars(-30, 32, 30, 40)],
      }),
    );
    expect(final.quality?.vehiclesOutsideNearby).toBeGreaterThan(5);
    expect(boundaryNeedsReview(final, parameters)).toBe(true);
  });

  it("sends a vehicle outline and a bare parcel to review", () => {
    expect(
      boundaryNeedsReview(
        finalize(input({ vehicles: cars(-25, -25, 25, 25) })),
        parameters,
      ),
    ).toBe(true);
    expect(
      boundaryNeedsReview(
        finalize(input({ parcels: [parcel(rect(-30, -30, 30, 30))] })),
        parameters,
      ),
    ).toBe(true);
  });
});

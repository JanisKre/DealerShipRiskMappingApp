import { describe, expect, it } from "vitest";
import { ringAreaSqm, unprojectPoint, type LonLat } from "../boundary-geometry";
import type { ParcelFeature } from "../alkis.service";
import {
  buildSiteGraph,
  frontier,
  parcelEvidence,
  parcelIndexAt,
  siteIdentity,
  unbuiltSqm,
  vehiclesOnParcels,
} from "./site-graph";

const ANCHOR: LonLat = [13.4, 52.5];

/** Point in metres east/north of the anchor. */
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

function parcel(
  ring: LonLat[],
  extra: Partial<ParcelFeature> = {},
): ParcelFeature {
  return { ring, areaSqm: ringAreaSqm(ring), state: "Sachsen", ...extra };
}

// A showroom plot at the point, a yard west of it, a neighbour east of it
// and a plot across a 12 m road to the south.
const showroom = parcel(rect(-20, -20, 20, 20), { address: "Hauptstraße 5" });
const yard = parcel(rect(-60, -20, -20, 20), { address: "Hauptstraße" });
const neighbour = parcel(rect(20, -20, 60, 20), { address: "Hauptstraße 7" });
const acrossRoad = parcel(rect(-20, -72, 20, -32));
const parcels = [showroom, yard, neighbour, acrossRoad];

describe("site graph: shared borders", () => {
  const graph = buildSiteGraph({
    anchor: ANCHOR,
    parcels,
    vehicles: null,
    buildings: [],
  });

  it("measures the border two plots share and none across a road", () => {
    // 40 m common side, plus the few metres around each corner within reach.
    expect(graph.shared[0].get(1)).toBeGreaterThan(38);
    expect(graph.shared[0].get(1)).toBeLessThan(50);
    expect(graph.shared[1].get(0)).toBeCloseTo(graph.shared[0].get(1)!, 0);
    expect(graph.shared[0].has(3)).toBe(false);
    expect(graph.perimeterM[0]).toBeCloseTo(160, 0);
  });

  it("lists the plots bordering a set as its frontier", () => {
    expect(frontier(graph, new Set([0])).sort()).toEqual([1, 2]);
    expect(frontier(graph, new Set([0, 1])).sort()).toEqual([2]);
  });

  it("finds the parcel at a point", () => {
    expect(parcelIndexAt(graph, ANCHOR)).toBe(0);
    expect(parcelIndexAt(graph, at(-40, 0))).toBe(1);
    expect(parcelIndexAt(graph, at(0, -26))).toBe(-1);
  });

  it("knows nothing about the border without an image", () => {
    const site = siteIdentity(graph, 0);
    const evidence = parcelEvidence(graph, new Set([0]), 1, site);
    expect(evidence.openBorderM).toBeNull();
    expect(evidence.greenBorder).toBeNull();
    expect(evidence.borderOfParcel).toBeGreaterThan(0.24);
    expect(evidence.borderOfParcel).toBeLessThan(0.32);
  });
});

describe("site graph: what the image shows on a border", () => {
  it("tells a hedge on the line from open ground", () => {
    // A hedge 2 m wide on the line to the neighbour; nothing to the yard.
    const hedgeWest = at(19, 0)[0];
    const hedgeEast = at(21, 0)[0];
    const graph = buildSiteGraph({
      anchor: ANCHOR,
      parcels,
      vehicles: null,
      buildings: [],
      vegetationAt: ([lon]) => lon >= hedgeWest && lon <= hedgeEast,
    });
    const site = siteIdentity(graph, 0);
    const toYard = parcelEvidence(graph, new Set([0]), 1, site);
    const toNeighbour = parcelEvidence(graph, new Set([0]), 2, site);
    expect(toYard.greenBorder).toBe(0);
    expect(toYard.openBorderM).toBeGreaterThan(38);
    expect(toNeighbour.greenBorder).toBeGreaterThan(0.8);
    expect(toNeighbour.openBorderM).toBeLessThan(8);
  });

  it("does not count a wall on the line as open ground", () => {
    // The neighbour's hall stands on the line along its whole length.
    const graph = buildSiteGraph({
      anchor: ANCHOR,
      parcels,
      vehicles: null,
      buildings: [rect(20.5, -20, 50, 20)],
      vegetationAt: () => false,
    });
    const site = siteIdentity(graph, 0);
    const evidence = parcelEvidence(graph, new Set([0]), 2, site);
    expect(evidence.openBorderM).toBeLessThan(8);
    expect(evidence.sharedBuilding).toBe(false);
    expect(evidence.ownBuilding).toBe(true);
  });
});

describe("site graph: buildings", () => {
  it("ties two plots by a building that stands on both", () => {
    // Showroom 30 × 20 m across the line to the yard, a third of it on the yard.
    const graph = buildSiteGraph({
      anchor: ANCHOR,
      parcels,
      vehicles: null,
      buildings: [rect(-30, -10, 0, 10), rect(30, -10, 50, 10)],
    });
    const site = siteIdentity(graph, 0);
    const toYard = parcelEvidence(graph, new Set([0]), 1, site);
    const toNeighbour = parcelEvidence(graph, new Set([0]), 2, site);
    expect(toYard.sharedBuilding).toBe(true);
    expect(toYard.ownBuilding).toBe(false);
    expect(toNeighbour.sharedBuilding).toBe(false);
    expect(toNeighbour.ownBuilding).toBe(true);
    expect(graph.builtSqm[0]).toBeCloseTo(400, -1);
    expect(graph.builtSqm[1]).toBeCloseTo(200, -1);
    expect(unbuiltSqm(graph, 0)).toBeCloseTo(1600 - 400, -1);
  });

  it("ignores a sliver of a building reaching over the line", () => {
    // One metre of a 30 m hall on the showroom plot.
    const graph = buildSiteGraph({
      anchor: ANCHOR,
      parcels,
      vehicles: null,
      buildings: [rect(19, -10, 49, 10)],
    });
    const site = siteIdentity(graph, 0);
    expect(parcelEvidence(graph, new Set([0]), 2, site).sharedBuilding).toBe(
      false,
    );
  });

  it("notes the first building when the plot at the point has none", () => {
    const graph = buildSiteGraph({
      anchor: ANCHOR,
      parcels,
      vehicles: null,
      buildings: [rect(-50, -10, -30, 10)],
    });
    const site = siteIdentity(graph, 0);
    expect(parcelEvidence(graph, new Set([0]), 1, site).firstBuilding).toBe(
      true,
    );
    expect(parcelEvidence(graph, new Set([0, 1]), 2, site).firstBuilding).toBe(
      false,
    );
  });
});

describe("site graph: vehicles", () => {
  // Rows from the showroom plot on into the yard; a separate lot on the
  // neighbour's plot, 20 m from the nearest row.
  const rows = cars(-55, -15, 0, 15);
  const foreign = cars(40, -15, 55, 15);
  const graph = buildSiteGraph({
    anchor: ANCHOR,
    parcels,
    vehicles: [...rows, ...foreign],
    buildings: [],
  });
  const site = siteIdentity(graph, 0);

  it("counts the vehicles on each plot", () => {
    expect(graph.vehiclesOn[0]).toHaveLength(24);
    expect(graph.vehiclesOn[1]).toHaveLength(42);
    expect(graph.vehiclesOn[2]).toHaveLength(18);
    expect(vehiclesOnParcels(graph, [0, 1])).toBe(66);
  });

  it("sees the rows of the lot at the point continue onto the yard", () => {
    const evidence = parcelEvidence(graph, new Set([0]), 1, site);
    expect(evidence.vehicles).toBe(42);
    expect(evidence.lotVehicles).toBe(42);
    expect(evidence.density).toBeCloseTo((42 / 1600) * 1000, 0);
    expect(evidence.siteVehicles).toBe(24);
  });

  it("does not take a separate lot for rows of the lot at the point", () => {
    const evidence = parcelEvidence(graph, new Set([0]), 2, site);
    expect(evidence.vehicles).toBe(18);
    expect(evidence.lotVehicles).toBe(0);
    // 20–35 m from the showroom plot: the first rows are near it.
    expect(evidence.nearVehicles).toBeLessThan(evidence.vehicles);
  });
});

describe("site graph: image extent", () => {
  it("marks plots outside the image as not seen", () => {
    // The image ends 30 m east of the point: half the neighbour is on it.
    const [west, south] = at(-100, -100);
    const [east, north] = at(40, 100);
    const graph = buildSiteGraph({
      anchor: ANCHOR,
      parcels,
      vehicles: [],
      buildings: [],
      imageBounds: [west, south, east, north],
    });
    expect(graph.seenShare[0]).toBe(1);
    expect(graph.seenShare[2]).toBeGreaterThan(0.4);
    expect(graph.seenShare[2]).toBeLessThan(0.6);
  });
});

describe("site graph: addresses", () => {
  const graph = buildSiteGraph({
    anchor: ANCHOR,
    parcels: [
      showroom,
      yard,
      neighbour,
      parcel(rect(-20, 20, 20, 60), { address: "Hauptstraße 5 b" }),
      parcel(rect(-60, 20, -20, 60), { address: "Nebenweg" }),
      parcel(rect(20, 20, 60, 60)),
    ],
    vehicles: null,
    buildings: [],
  });

  it("reads a house number with another letter as the same number", () => {
    const site = siteIdentity(graph, 0);
    const relation = (index: number): string =>
      parcelEvidence(graph, new Set([0]), index, site).address;
    expect(relation(3)).toBe("same");
    expect(relation(2)).toBe("other");
    expect(relation(1)).toBe("street");
    expect(relation(4)).toBe("none");
    expect(relation(5)).toBe("none");
  });

  it("takes the dealership's own address into the identity of the site", () => {
    const site = siteIdentity(
      graph,
      1,
      "Autohaus Muster, Hauptstraße 7, 01234 Musterstadt",
    );
    expect(parcelEvidence(graph, new Set([1]), 0, site).address).toBe("other");
    expect(site.keys.has("hauptstr|7")).toBe(true);
    expect(site.streets.has("hauptstr")).toBe(true);
  });
});

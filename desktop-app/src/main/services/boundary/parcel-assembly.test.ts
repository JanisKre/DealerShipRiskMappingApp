import { describe, expect, it } from "vitest";
import {
  assembleSiteFromParcels,
  HARD_REJECT_RATIO,
  MIN_SHARED_EDGE_M,
  overlapRatio,
  sharesEdge,
  SHOWROOM_FOOTPRINT_SQM,
} from "./parcel-assembly";
import { polygon as turfPolygon } from "@turf/helpers";
import { unprojectPoint, type LonLat } from "../boundary-geometry";
import type { Polygon } from "@shared/types";
import type { ParcelFeature } from "../alkis.service";

const ORIGIN: LonLat = [13.4, 52.5];

/** Axis-aligned rectangle from metric offsets about the origin. */
function rect(
  west: number,
  south: number,
  east: number,
  north: number,
): LonLat[] {
  const ring = (
    [
      [west, south],
      [east, south],
      [east, north],
      [west, north],
    ] as Array<[number, number]>
  ).map((c) => unprojectPoint(c, ORIGIN));
  ring.push(ring[0]);
  return ring;
}

const poly = (ring: LonLat[]): Polygon => ({
  type: "Polygon",
  coordinates: [ring],
});
const feat = (ring: LonLat[]): never => turfPolygon([ring]) as never;
const parcel = (ring: LonLat[]): ParcelFeature => ({
  ring,
  areaSqm: 0,
  state: "Berlin",
});


describe("sharesEdge", () => {
  it("accepts parcels that abut along a long boundary", () => {
    expect(sharesEdge(rect(-40, -20, 0, 20), rect(0, -20, 40, 20))).toBe(
      true,
    );
  });

  it("rejects parcels separated by a street", () => {
    // 12 m gap: close, but a different site.
    expect(
      sharesEdge(rect(-40, -20, -6, 20), rect(6, -20, 40, 20)),
    ).toBe(false);
  });

  it("rejects parcels touching only at a corner", () => {
    expect(
      sharesEdge(rect(-40, -40, 0, 0), rect(0, 0, 40, 40)),
    ).toBe(false);
  });

  it("rejects a shared edge shorter than the minimum", () => {
    // 3 m of contact, below the 5 m floor.
    expect(
      sharesEdge(rect(-40, -20, 0, 20), rect(0, 17, 40, 20)),
    ).toBe(false);
    expect(MIN_SHARED_EDGE_M).toBe(5);
  });

  it("accepts genuinely overlapping parcels", () => {
    expect(
      sharesEdge(rect(-40, -20, 10, 20), rect(-10, -20, 40, 20)),
    ).toBe(true);
  });
});

describe("overlapRatio", () => {
  it("measures the covered share of the subject", () => {
    expect(
      overlapRatio(feat(rect(0, 0, 40, 40)), feat(rect(0, 0, 20, 40))),
    ).toBeCloseTo(0.5, 2);
  });

  it("is 0 for disjoint geometry", () => {
    expect(
      overlapRatio(feat(rect(0, 0, 10, 10)), feat(rect(100, 100, 110, 110))),
    ).toBe(0);
  });
});

describe("assembleSiteFromParcels", () => {
  const anchor = unprojectPoint([-20, 0], ORIGIN);

  it("returns the single parcel containing the point when nothing else applies", () => {
    const result = assembleSiteFromParcels([parcel(rect(-40, -20, 0, 20))], anchor);
    expect(result).not.toBeNull();
    expect(result!.parcelCount).toBe(1);
    expect(result!.anchorContainsPoint).toBe(true);
    expect(result!.areaSqm).toBeGreaterThan(1_500);
  });

  it("unions adjacent parcels that carry their own evidence", () => {
    // A dealership across two abutting plots; a mapped parking area vouches
    // for the second one.
    const result = assembleSiteFromParcels(
      [parcel(rect(-40, -20, 0, 20)), parcel(rect(0, -20, 40, 20))],
      anchor,
      { supporting: [poly(rect(5, -15, 35, 15))] },
    );
    expect(result!.parcelCount).toBe(2);
    expect(result!.expandedCount).toBe(1);
    // 80 m x 40 m.
    expect(result!.areaSqm).toBeGreaterThan(3_000);
  });

  it("does NOT absorb an adjacent parcel with no evidence", () => {
    // The neighbouring business abuts us but is not ours.
    const result = assembleSiteFromParcels(
      [parcel(rect(-40, -20, 0, 20)), parcel(rect(0, -20, 40, 20))],
      anchor,
      { supporting: [] },
    );
    expect(result!.parcelCount).toBe(1);
    expect(result!.expandedCount).toBe(0);
  });

  it("does not cross a street even when the far parcel has evidence", () => {
    const result = assembleSiteFromParcels(
      [parcel(rect(-40, -20, -6, 20)), parcel(rect(6, -20, 40, 20))],
      anchor,
      { supporting: [poly(rect(8, -15, 38, 15))] },
    );
    expect(result!.parcelCount).toBe(1);
  });

  it("chains across several evidenced parcels", () => {
    const result = assembleSiteFromParcels(
      [
        parcel(rect(-40, -20, 0, 20)),
        parcel(rect(0, -20, 30, 20)),
        parcel(rect(30, -20, 60, 20)),
      ],
      anchor,
      { supporting: [poly(rect(2, -15, 58, 15))] },
    );
    expect(result!.parcelCount).toBe(3);
    expect(result!.expandedCount).toBe(2);
  });

  it("rejects a parcel far larger than a mapped lot outline", () => {
    // Footprint above the showroom threshold, so the tight ratio applies.
    const footprint = poly(rect(-15, -10, 15, 10)); // 600 m²... below threshold
    const bigFootprint = poly(rect(-30, -20, 30, 20)); // 2400 m²
    expect(SHOWROOM_FOOTPRINT_SQM).toBe(1_000);
    const result = assembleSiteFromParcels(
      [parcel(rect(-200, -200, 200, 200))],
      unprojectPoint([0, 0], ORIGIN),
      { supporting: [], footprint: bigFootprint },
    );
    expect(result).toBeNull();
    void footprint;
  });

  it("tolerates a huge parcel when OSM mapped only the showroom", () => {
    // 20 m x 20 m showroom (400 m²) inside an 80 m x 80 m compound (6,400 m²):
    // a 16x ratio is legitimate here, and rejecting it would lose a correct
    // parcel exactly where the evidence is thinnest.
    const showroom = poly(rect(-10, -10, 10, 10));
    const result = assembleSiteFromParcels(
      [parcel(rect(-40, -40, 40, 40))],
      unprojectPoint([0, 0], ORIGIN),
      { supporting: [], footprint: showroom },
    );
    expect(result).not.toBeNull();
    expect(HARD_REJECT_RATIO).toBe(25);
  });

  it("falls back to the nearest parcel when the geocode misses", () => {
    // Anchor on the pavement, 10 m outside the plot.
    const result = assembleSiteFromParcels(
      [parcel(rect(0, -20, 40, 20))],
      unprojectPoint([-10, 0], ORIGIN),
    );
    expect(result).not.toBeNull();
    expect(result!.anchorContainsPoint).toBe(false);
    expect(result!.reasons.join(" ")).toMatch(/no parcel contains/);
  });

  it("gives up when the nearest parcel is too far to be this site", () => {
    expect(
      assembleSiteFromParcels(
        [parcel(rect(200, 200, 240, 240))],
        unprojectPoint([0, 0], ORIGIN),
      ),
    ).toBeNull();
  });

  it("returns null for no parcels", () => {
    expect(assembleSiteFromParcels([], anchor)).toBeNull();
  });

  it("is deterministic", () => {
    const parcels = [parcel(rect(-40, -20, 0, 20)), parcel(rect(0, -20, 40, 20))];
    const evidence = { supporting: [poly(rect(5, -15, 35, 15))] };
    expect(assembleSiteFromParcels(parcels, anchor, evidence)).toEqual(
      assembleSiteFromParcels(parcels, anchor, evidence),
    );
  });
});

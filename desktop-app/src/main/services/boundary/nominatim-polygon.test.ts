import { describe, expect, it } from "vitest";
import {
  extractNominatimRing,
  pickNominatimRing,
  MAX_MATCH_DISTANCE_M,
  type NominatimItem,
} from "./nominatim-polygon";
import { unprojectPoint, type LonLat } from "../boundary-geometry";

const ANCHOR: LonLat = [13.4, 52.5];

/** Square of `half` metres, centred `offsetE`/`offsetN` metres from the anchor. */
function square(half: number, offsetE = 0, offsetN = 0): number[][] {
  const corners: Array<[number, number]> = [
    [offsetE - half, offsetN - half],
    [offsetE + half, offsetN - half],
    [offsetE + half, offsetN + half],
    [offsetE - half, offsetN + half],
  ];
  const ring = corners.map((c) => unprojectPoint(c, ANCHOR) as number[]);
  ring.push([...ring[0]]);
  return ring;
}

describe("extractNominatimRing", () => {
  it("reads a Polygon's outer ring", () => {
    const ring = extractNominatimRing({
      geojson: { type: "Polygon", coordinates: [square(40)] },
    });
    expect(ring).not.toBeNull();
    expect(ring![0]).toEqual(ring![ring!.length - 1]);
  });

  it("takes the largest part of a MultiPolygon", () => {
    // A dealership split by a road is mapped this way; the main lot is the
    // part worth proposing.
    const ring = extractNominatimRing({
      geojson: {
        type: "MultiPolygon",
        coordinates: [[square(10)], [square(60)]],
      },
    });
    expect(ring).not.toBeNull();
    const spanM = Math.abs(ring![1][0] - ring![0][0]) * 111_320 * Math.cos((52.5 * Math.PI) / 180);
    expect(spanM).toBeGreaterThan(100);
  });

  it("returns null for a Point match", () => {
    expect(
      extractNominatimRing({ geojson: { type: "Point", coordinates: [13.4, 52.5] } }),
    ).toBeNull();
  });

  it("returns null when no geometry was requested or returned", () => {
    expect(extractNominatimRing({})).toBeNull();
  });

  it("rejects malformed coordinates instead of throwing", () => {
    expect(
      extractNominatimRing({
        geojson: { type: "Polygon", coordinates: [[["a", "b"], [1, 2], [3, 4], [5, 6]]] },
      }),
    ).toBeNull();
    expect(
      extractNominatimRing({ geojson: { type: "Polygon", coordinates: [[[1, 2]]] } }),
    ).toBeNull();
  });
});

describe("pickNominatimRing", () => {
  const item = (coords: number[][], name = "Autohaus"): NominatimItem => ({
    display_name: name,
    geojson: { type: "Polygon", coordinates: [coords] },
  });

  it("prefers a polygon that contains the anchor", () => {
    const match = pickNominatimRing(
      [item(square(20, 300, 0), "far"), item(square(50), "here")],
      ANCHOR[1],
      ANCHOR[0],
    );
    expect(match?.contains).toBe(true);
    expect(match?.item.display_name).toBe("here");
  });

  it("accepts a nearby polygon that does not contain the anchor", () => {
    const match = pickNominatimRing([item(square(30, 60, 0))], ANCHOR[1], ANCHOR[0]);
    expect(match).not.toBeNull();
    expect(match?.contains).toBe(false);
  });

  it("rejects a same-named match in another place", () => {
    // Proximity is a hard gate, not a tiebreak: Nominatim will match a branch
    // of the same dealer group in a different city.
    const farAway = square(40, 5_000, 5_000);
    expect(pickNominatimRing([item(farAway)], ANCHOR[1], ANCHOR[0])).toBeNull();
  });

  it("honours the distance gate exactly", () => {
    const justOutside = square(10, MAX_MATCH_DISTANCE_M + 60, 0);
    expect(pickNominatimRing([item(justOutside)], ANCHOR[1], ANCHOR[0])).toBeNull();
    const justInside = square(10, MAX_MATCH_DISTANCE_M - 60, 0);
    expect(pickNominatimRing([item(justInside)], ANCHOR[1], ANCHOR[0])).not.toBeNull();
  });

  it("skips geometry that fails the ring check", () => {
    // 2 m square: far below the 100 m² floor.
    expect(pickNominatimRing([item(square(1))], ANCHOR[1], ANCHOR[0])).toBeNull();
  });

  it("skips an implausibly large match such as a whole municipality", () => {
    expect(pickNominatimRing([item(square(2_000))], ANCHOR[1], ANCHOR[0])).toBeNull();
  });

  it("returns null for an empty result set", () => {
    expect(pickNominatimRing([], ANCHOR[1], ANCHOR[0])).toBeNull();
  });
});

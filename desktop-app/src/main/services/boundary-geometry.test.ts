import { describe, expect, it } from "vitest";
import {
  approximatePolygonIoU,
  checkRing,
  distanceToRingM,
} from "./boundary-geometry";
import { polygon as turfPolygon } from "@turf/helpers";
import type { Polygon } from "@shared/types";

const square = (offsetM = 0): Polygon => {
  const d = offsetM / 111_320;
  return turfPolygon([
    [
      [10 + d, 51 + d],
      [10.001 + d, 51 + d],
      [10.001 + d, 51.001 + d],
      [10 + d, 51.001 + d],
      [10 + d, 51 + d],
    ],
  ]).geometry as Polygon;
};

describe("boundary geometry quality", () => {
  it("rejects open and self-intersecting rings", () => {
    expect(checkRing(square().coordinates[0] as [number, number][]).valid).toBe(
      true,
    );
    expect(
      checkRing([
        [10, 51],
        [10.001, 51.001],
        [10, 51.001],
        [10.001, 51],
        [10, 51],
      ]).valid,
    ).toBe(false);
  });

  it("calculates overlap and metric distances", () => {
    const a = square() as Polygon;
    const b = square(2) as Polygon;
    expect(approximatePolygonIoU(a, a)).toBeGreaterThan(0.95);
    expect(approximatePolygonIoU(a, b)).toBeGreaterThan(0.9);
    expect(
      distanceToRingM(
        [10.0005, 51.0005],
        a.coordinates[0] as [number, number][],
      ),
    ).toBeGreaterThan(30);
  });
});
